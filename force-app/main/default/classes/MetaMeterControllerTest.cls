@IsTest
private class MetaMeterControllerTest {
  @IsTest
  static void storageRulesMatchAllocationModel() {
    Map<String, Integer> fixedCosts = new Map<String, Integer>{
      'BOOLEAN' => 10,
      'DATE' => 10,
      'DATETIME' => 10,
      'PICKLIST' => 10,
      'PHONE' => 40,
      'EMAIL' => 80,
      'URL' => 255
    };
    for (String kind : fixedCosts.keySet()) {
      MetaMeterController.FieldCost field = MetaMeterController.calculateCost(
        kind,
        255,
        0,
        new Set<String>()
      );
      Assert.areEqual(fixedCosts.get(kind), field.charactersPerRecord, kind);
      Assert.isFalse(field.shrinkable, kind);
    }
    MetaMeterController.FieldCost text = MetaMeterController.calculateCost(
      'STRING',
      200,
      0,
      new Set<String>()
    );
    Assert.areEqual(200, text.charactersPerRecord);
    Assert.isTrue(text.shrinkable);
    Assert.areEqual(
      255,
      MetaMeterController.calculateCost(
          'TEXTAREA',
          131072,
          0,
          new Set<String>()
        )
        .charactersPerRecord
    );
    Assert.areEqual(
      255,
      MetaMeterController.calculateCost('TEXTAREA', 255, 0, new Set<String>())
        .charactersPerRecord
    );
    for (
      String kind : new List<String>{
        'DOUBLE',
        'CURRENCY',
        'PERCENT',
        'INTEGER'
      }
    ) {
      Assert.areEqual(
        18,
        MetaMeterController.calculateCost(kind, 0, 18, new Set<String>())
          .charactersPerRecord
      );
    }
    Assert.areEqual(
      4,
      MetaMeterController.calculateCost('DOUBLE', 0, 4, new Set<String>())
        .charactersPerRecord
    );
    Assert.areEqual(
      10,
      MetaMeterController.calculateCost(
          'REFERENCE',
          18,
          0,
          new Set<String>{ 'EntityDefinition' }
        )
        .charactersPerRecord
    );
    Assert.areEqual(
      10,
      MetaMeterController.calculateCost(
          'REFERENCE',
          18,
          0,
          new Set<String>{ 'FieldDefinition' }
        )
        .charactersPerRecord
    );
    Assert.areEqual(
      15,
      MetaMeterController.calculateCost(
          'REFERENCE',
          18,
          0,
          new Set<String>{ 'Other__mdt' }
        )
        .charactersPerRecord
    );
    Integer perRecord = MetaMeterController.BASE_CHARACTERS + 100 + 200 + 255;
    Assert.areEqual(696, perRecord);
    Assert.areEqual(348000, perRecord * 500);
    Assert.areEqual('', MetaMeterController.namespaceOf('Settings__mdt'));
    Assert.areEqual(
      'vendor',
      MetaMeterController.namespaceOf('vendor__Settings__mdt')
    );
  }

  @IsTest
  static void invalidInputsCannotQueryOtherObjects() {
    for (
      String apiName : new List<String>{
        null,
        '',
        'Account',
        'Account WHERE Name != null',
        'Missing__mdt'
      }
    ) {
      try {
        MetaMeterController.getFieldDefinitions(apiName);
        Assert.fail('Invalid object must be rejected');
      } catch (AuraHandledException expected) {
        Assert.isTrue(expected.getMessage().contains('Custom Metadata Type'));
      }
    }
    List<MetaMeterController.TypeUsage> unavailable = MetaMeterController.getRecordCounts(
      new List<String>{ 'Missing__mdt' }
    );
    Assert.isNotNull(unavailable[0].warning);
    Assert.isNull(unavailable[0].recordCount);
    Assert.isNull(unavailable[0].totalCharacters);
    Assert.areEqual(
      0,
      MetaMeterController.getRecordCounts(new List<String>()).size()
    );
    for (
      List<String> names : new List<List<String>>{
        null,
        new List<String>{
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          '10',
          '11',
          '12',
          '13',
          '14',
          '15',
          '16',
          '17',
          '18',
          '19',
          '20',
          '21'
        }
      }
    ) {
      try {
        MetaMeterController.getRecordCounts(names);
        Assert.fail('Oversized or null batch must be rejected');
      } catch (AuraHandledException expected) {
        Assert.isTrue(expected.getMessage().contains('20'));
      }
    }
  }

  @IsTest
  static void discoveredMetadataIsCalculatedAndPaged() {
    Test.startTest();
    MetaMeterController.Catalog catalog = MetaMeterController.getCatalog();
    Assert.areEqual(10000000, catalog.orgLimit);
    Assert.areEqual(141, catalog.baseCharacters);
    // Custom metadata is visible in isolated tests. No fixture records or
    // dependency on a particular org's type names are needed.
    Boolean scanned = false;
    for (MetaMeterController.TypeUsage type : catalog.types) {
      Assert.isTrue(type.apiName.endsWith('__mdt'));
      List<MetaMeterController.FieldCost> fields = MetaMeterController.getFieldDefinitions(
        type.apiName
      );
      Integer expectedCost = 141;
      for (MetaMeterController.FieldCost field : fields)
        expectedCost += field.charactersPerRecord;
      Assert.areEqual(fields.size(), type.fieldCount);
      Assert.areEqual(expectedCost, type.charactersPerRecord);
      List<MetaMeterController.TypeUsage> counts = MetaMeterController.getRecordCounts(
        new List<String>{ type.apiName }
      );
      if (counts[0].warning == null) {
        Assert.areEqual(
          Long.valueOf(String.valueOf(counts[0].recordCount)) * expectedCost,
          counts[0].totalCharacters
        );
      }
      if (!scanned && !fields.isEmpty()) {
        MetaMeterController.ValuePage page = MetaMeterController.getFieldValuePage(
          type.apiName,
          fields[0].apiName,
          null
        );
        Assert.isTrue(page.longestValues.get(fields[0].apiName) >= 0);
        Assert.isTrue(page.recordsScanned >= 0 && page.recordsScanned <= 1000);
        if (page.nextCursor != null) {
          MetaMeterController.ValuePage next = MetaMeterController.getFieldValuePage(
            type.apiName,
            fields[0].apiName,
            page.nextCursor
          );
          Assert.isNotNull(next.done);
        }
        for (
          String invalidField : new List<String>{
            'Id',
            'Missing__c',
            'Name FROM Account'
          }
        ) {
          try {
            MetaMeterController.getFieldValuePage(
              type.apiName,
              invalidField,
              null
            );
            Assert.fail('Invalid field must be rejected');
          } catch (AuraHandledException expected) {
            Assert.isTrue(expected.getMessage().contains('custom field'));
          }
        }
        for (
          String invalidCursor : new List<String>{
            'bad-cursor',
            '001000000000001'
          }
        ) {
          try {
            MetaMeterController.getFieldValuePage(
              type.apiName,
              fields[0].apiName,
              invalidCursor
            );
            Assert.fail('Invalid cursor must be rejected');
          } catch (AuraHandledException expected) {
            Assert.isTrue(expected.getMessage().contains('cursor'));
          }
        }
        scanned = true;
      }
      // Keep this schema-integration check bounded in heavily packaged orgs.
      if (scanned)
        break;
    }
    Test.stopTest();
  }
}
