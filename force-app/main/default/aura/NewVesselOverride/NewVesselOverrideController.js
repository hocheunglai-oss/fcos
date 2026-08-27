({
  handleVesselNameToUpperCase: function (component) {
    const value = component.get("v.VesselName");
    component.set("v.VesselName", value ? value.toUpperCase() : value);
  },
  saveRecord: function (component, event, helper) {
    helper.saveAndSaveNewHelper(component, event, helper, function () {
      $A.get("e.force:refreshView").fire();
    });
  },
  cancel: function () {
    const homeEvt = $A.get("e.force:navigateToObjectHome");
    homeEvt.setParams({ scope: "Vessel__c" });
    homeEvt.fire();
    $A.get("e.force:refreshView").fire();
  }
})
