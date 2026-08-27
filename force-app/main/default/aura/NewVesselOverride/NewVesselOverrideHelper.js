({
  disabledButton: function (component, disabled) {
    component.find("saveId").set("v.disabled", disabled);
    component.find("saveAndNewId").set("v.disabled", disabled);
    component.find("cancelId").set("v.disabled", disabled);
  },
  saveAndSaveNewHelper: function (component, event, helper, done) {
    const buttonId = event.getSource().getLocalId();
    const name = component.get("v.VesselName");
    const imo = component.get("v.IMO");
    const nrt = component.get("v.NRT");
    const remark = component.get("v.Remark");
    if (!name) {
      component.find("notifLib").showToast({ title: "Error", message: "Name is required", variant: "error" });
      return;
    }
    if (nrt != null && nrt !== "" && (!Number.isInteger(Number(nrt)) || Number(nrt) <= 0)) {
      component.find("notifLib").showToast({ title: "Error", message: "NRT must be a positive whole number.", variant: "error" });
      return;
    }
    helper.disabledButton(component, true);
    const action = component.get("c.checkVesselsByIMO");
    action.setParams({ imo: imo });
    action.setCallback(this, function (response) {
      if (response.getState() !== "SUCCESS") {
        const errors = response.getError();
        helper.disabledButton(component, false);
        component.find("notifLib").showToast({ title: "Error", message: errors[0].message, variant: "error" });
        return;
      }
      const existing = response.getReturnValue() || [];
      const create = function () { helper.createVessel(component, name, imo, nrt, remark, existing.map(function (v) { return v.Id; }), buttonId, done); };
      if (!existing.length || !imo) { create(); return; }
      helper.disabledButton(component, false);
      $A.createComponent("c:ConfirmModalContent", {
        message: "There are already vessels with IMO " + imo + ". Proceeding will mark them inactive.",
        onProceed: create
      }, function (content, status, errorMessage) {
        if (status === "SUCCESS") component.find("overlayLib").showCustomModal({ body: content, showCloseButton: true, cssClass: "slds-modal_medium custom-warning-modal" }).then(function (overlay) { content.set("v.overlay", overlay); });
        else component.find("notifLib").showToast({ title: "Error", message: errorMessage, variant: "error" });
      });
    });
    $A.enqueueAction(action);
  },
  createVessel: function (component, name, imo, nrt, remark, oldIds, buttonId, done) {
    const helper = this;
    const action = component.get("c.createVessel");
    action.setParams({ newVessel: { sobjectType: "Vessel__c", Name: name, IMO__c: imo, NRT__c: nrt || null, Remark__c: remark }, oldVesselIds: oldIds });
    action.setCallback(this, function (response) {
      helper.disabledButton(component, false);
      if (response.getState() !== "SUCCESS") {
        const errors = response.getError();
        component.find("notifLib").showToast({ title: "Error", message: errors[0].pageErrors ? errors[0].pageErrors[0].message : errors[0].message, variant: "error" });
        return;
      }
      const record = response.getReturnValue();
      component.find("notifLib").showToast({ title: "Success", message: "Vessel created successfully", variant: "success" });
      if (buttonId === "saveId") {
        const navEvt = $A.get("e.force:navigateToSObject");
        navEvt.setParams({ recordId: record.Id, slideDevName: "related" });
        navEvt.fire();
      } else if (done) done();
    });
    $A.enqueueAction(action);
  }
})
