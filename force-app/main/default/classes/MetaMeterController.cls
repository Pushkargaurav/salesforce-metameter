public with sharing class MetaMeterController {
  public static final Integer ORG_LIMIT = 10000000;
  public static final Integer BASE_CHARACTERS = 141;

  public class TypeUsage {
    @AuraEnabled
    public String apiName;
    @AuraEnabled
    public String label;
    @AuraEnabled
    public String namespacePrefix;
    @AuraEnabled
    public Integer fieldCount;
    @AuraEnabled
    public Integer charactersPerRecord;
    @AuraEnabled
    public Integer recordCount;
    @AuraEnabled
    public Long totalCharacters;
    @AuraEnabled
    public String warning;
  }
  public class Catalog {
    @AuraEnabled
    public Integer orgLimit = ORG_LIMIT;
    @AuraEnabled
    public Integer baseCharacters = BASE_CHARACTERS;
    @AuraEnabled
    public List<TypeUsage> types = new List<TypeUsage>();
  }
  public class FieldCost {
    @AuraEnabled
    public String apiName;
    @AuraEnabled
    public String label;
    @AuraEnabled
    public String fieldType;
    @AuraEnabled
    public Integer declaredSize;
    @AuraEnabled
    public Integer charactersPerRecord;
    @AuraEnabled
    public String reason;
    @AuraEnabled
    public Boolean shrinkable;
  }
  public class ValuePage {
    @AuraEnabled
    public Map<String, Integer> longestValues = new Map<String, Integer>();
    @AuraEnabled
    public String nextCursor;
    @AuraEnabled
    public Integer recordsScanned = 0;
    @AuraEnabled
    public Boolean done;
  }

  // Intentionally not cacheable: Refresh must read current definitions and records.
  @AuraEnabled
  public static Catalog getCatalog() {
    Catalog result = new Catalog();
    Map<String, Schema.SObjectType> types = Schema.getGlobalDescribe();
    List<String> names = new List<String>(types.keySet());
    names.sort();
    for (String name : names) {
      if (!name.endsWith('__mdt'))
        continue;
      Schema.DescribeSObjectResult description = types.get(name).getDescribe();
      TypeUsage row = new TypeUsage();
      row.apiName = description.getName();
      row.label = description.getLabel();
      row.namespacePrefix = namespaceOf(row.apiName);
      row.fieldCount = 0;
      row.charactersPerRecord = BASE_CHARACTERS;
      for (Schema.SObjectField field : description.fields.getMap().values()) {
        Schema.DescribeFieldResult definition = field.getDescribe();
        if (!definition.isCustom())
          continue;
        row.fieldCount++;
        row.charactersPerRecord += describeCost(definition).charactersPerRecord;
      }
      result.types.add(row);
    }
    return result;
  }

  @AuraEnabled
  public static List<TypeUsage> getRecordCounts(List<String> apiNames) {
    if (apiNames == null || apiNames.size() > 20) {
      throw handled('Request up to 20 Custom Metadata Types at a time.');
    }
    Map<String, Schema.SObjectType> types = Schema.getGlobalDescribe();
    List<TypeUsage> result = new List<TypeUsage>();
    for (String apiName : apiNames) {
      TypeUsage row = new TypeUsage();
      row.apiName = apiName;
      try {
        Schema.DescribeSObjectResult description = requireType(apiName, types);
        row.charactersPerRecord = BASE_CHARACTERS;
        for (Schema.SObjectField field : description.fields.getMap().values()) {
          Schema.DescribeFieldResult definition = field.getDescribe();
          if (definition.isCustom()) {
            row.charactersPerRecord += describeCost(definition)
              .charactersPerRecord;
          }
        }
        row.recordCount = Database.countQuery(
          'SELECT COUNT() FROM ' + description.getName()
        );
        row.totalCharacters =
          Long.valueOf(String.valueOf(row.recordCount)) *
          row.charactersPerRecord;
      } catch (Exception problem) {
        row.warning =
          'Records could not be counted. This type is excluded from totals. ' +
          problem.getMessage();
      }
      result.add(row);
    }
    return result;
  }

  @AuraEnabled
  public static List<FieldCost> getFieldDefinitions(String apiName) {
    Schema.DescribeSObjectResult description = requireType(
      apiName,
      Schema.getGlobalDescribe()
    );
    Map<String, Schema.SObjectField> fields = description.fields.getMap();
    List<String> names = new List<String>(fields.keySet());
    names.sort();
    List<FieldCost> result = new List<FieldCost>();
    for (String name : names) {
      Schema.DescribeFieldResult definition = fields.get(name).getDescribe();
      if (definition.isCustom())
        result.add(describeCost(definition));
    }
    return result;
  }

  // Scan one field at a time. Page size bounds even maximum-length long text
  // values below the synchronous heap limit. Only lengths leave the server.
  @AuraEnabled
  public static ValuePage getFieldValuePage(
    String apiName,
    String fieldName,
    String cursor
  ) {
    Schema.DescribeSObjectResult description = requireType(
      apiName,
      Schema.getGlobalDescribe()
    );
    Schema.SObjectField field = description.fields.getMap().get(fieldName);
    if (field == null || !field.getDescribe().isCustom()) {
      throw handled(
        'Choose a custom field on the selected Custom Metadata Type.'
      );
    }
    Schema.DescribeFieldResult definition = field.getDescribe();
    Integer pageSize = Math.max(
      1,
      Math.min(1000, 500000 / Math.max(1, definition.getLength()))
    );
    Id afterId;
    if (String.isNotBlank(cursor)) {
      try {
        afterId = Id.valueOf(cursor);
        if (afterId.getSObjectType() != typesToken(description.getName())) {
          throw handled('The page cursor belongs to a different type.');
        }
      } catch (Exception problem) {
        throw handled('Invalid page cursor. Refresh and try again.');
      }
    }
    String query =
      'SELECT Id, ' +
      definition.getName() +
      ' FROM ' +
      description.getName();
    if (afterId != null)
      query += ' WHERE Id > :afterId';
    query += ' ORDER BY Id LIMIT :pageSize';
    List<SObject> records = Database.query(query);
    ValuePage result = new ValuePage();
    Integer longest = 0;
    for (SObject record : records) {
      Object value = record.get(definition.getName());
      if (value != null)
        longest = Math.max(longest, String.valueOf(value).length());
    }
    result.longestValues.put(definition.getName(), longest);
    result.recordsScanned = records.size();
    result.done = records.size() < pageSize;
    if (!records.isEmpty())
      result.nextCursor = String.valueOf(records[records.size() - 1].get('Id'));
    return result;
  }

  private static Schema.SObjectType typesToken(String apiName) {
    return Schema.getGlobalDescribe().get(apiName);
  }
  private static Schema.DescribeSObjectResult requireType(
    String apiName,
    Map<String, Schema.SObjectType> types
  ) {
    if (
      String.isBlank(apiName) ||
      !apiName.endsWith('__mdt') ||
      !types.containsKey(apiName)
    ) {
      throw handled('Choose an available Custom Metadata Type.');
    }
    return types.get(apiName).getDescribe();
  }
  @TestVisible
  private static String namespaceOf(String apiName) {
    List<String> parts = apiName.split('__');
    return parts.size() > 2 ? parts[0] : '';
  }
  private static FieldCost describeCost(Schema.DescribeFieldResult field) {
    Set<String> references = new Set<String>();
    for (Schema.SObjectType target : field.getReferenceTo())
      references.add(target.getDescribe().getName());
    FieldCost result = calculateCost(
      String.valueOf(field.getType()),
      field.getLength(),
      field.getPrecision(),
      references
    );
    result.apiName = field.getName();
    result.label = field.getLabel();
    return result;
  }
  @TestVisible
  private static FieldCost calculateCost(
    String fieldType,
    Integer length,
    Integer precision,
    Set<String> references
  ) {
    FieldCost result = new FieldCost();
    result.fieldType = fieldType;
    result.declaredSize = length;
    result.shrinkable = fieldType == 'STRING';
    if (
      fieldType == 'BOOLEAN' ||
      fieldType == 'DATE' ||
      fieldType == 'DATETIME' ||
      fieldType == 'PICKLIST'
    ) {
      result.charactersPerRecord = 10;
      result.reason = 'Fixed for ' + fieldType.toLowerCase();
    } else if (fieldType == 'PHONE') {
      result.charactersPerRecord = 40;
      result.reason = 'Fixed for Phone';
    } else if (fieldType == 'EMAIL') {
      result.charactersPerRecord = 80;
      result.reason = 'Fixed for Email';
    } else if (fieldType == 'URL') {
      result.charactersPerRecord = 255;
      result.reason = 'Fixed for URL';
    } else if (fieldType == 'TEXTAREA') {
      result.charactersPerRecord = Math.min(255, length);
      result.reason = length > 255
        ? 'Long text, capped at 255'
        : 'Text area, capped at 255';
    } else if (fieldType == 'REFERENCE') {
      Boolean schemaReference =
        references.contains('EntityDefinition') ||
        references.contains('FieldDefinition');
      result.charactersPerRecord = schemaReference ? 10 : 15;
      result.reason = schemaReference
        ? 'Relationship to object or field'
        : 'Relationship to another metadata type';
      result.declaredSize = length;
    } else if (
      fieldType == 'DOUBLE' ||
      fieldType == 'CURRENCY' ||
      fieldType == 'PERCENT' ||
      fieldType == 'INTEGER'
    ) {
      result.charactersPerRecord = precision;
      result.declaredSize = precision;
      result.reason = 'Numeric precision (total digits)';
    } else {
      result.charactersPerRecord = Math.min(255, length);
      result.reason = 'Declared text length';
    }
    return result;
  }
  private static AuraHandledException handled(String message) {
    AuraHandledException problem = new AuraHandledException(message);
    problem.setMessage(message);
    return problem;
  }
}
