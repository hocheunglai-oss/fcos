@RestResource(urlMapping='/fcos/special-term-revisions/*')
global without sharing class SpecialTermRevisionRest {
    global class RequestBody { public String termId; public String approverEmail; public String reason; public String expectedLastModifiedAt; public Map<String, String> expectedVersionTimestamps; }
    global class ResponseBody { public Boolean success; public String revisionId; public String termId; public String status; public String message; }

    private static List<String> pathParts() {
        List<String> parts = RestContext.request.requestURI.split('/');
        for (Integer index = 0; index < parts.size(); index++) if (parts[index] == 'special-term-revisions' && index + 2 < parts.size()) return new List<String>{ parts[index + 1], parts[index + 2] };
        return new List<String>();
    }

    @HttpPost
    global static ResponseBody execute() {
        RequestBody body = String.isBlank(RestContext.request.requestBody == null ? null : RestContext.request.requestBody.toString()) ? new RequestBody() : (RequestBody) JSON.deserialize(RestContext.request.requestBody.toString(), RequestBody.class);
        List<String> path = pathParts();
        String revisionId = path.isEmpty() ? null : path[0];
        String action = path.size() > 1 ? path[1] : null;
        ResponseBody result = new ResponseBody();
        try {
            if (action == 'retire') {
                if (body.termId != null && body.termId != revisionId) throw new SpecialTermRevisionService.RevisionException('The supplied Special Term does not match the retirement path.');
                Id retiredRevisionId = SpecialTermRevisionService.retireTerm((Id) revisionId, body.approverEmail, body.reason, body.expectedLastModifiedAt);
                result.success = true; result.revisionId = retiredRevisionId; result.termId = revisionId; result.status = 'Retired';
                RestContext.response.statusCode = 200;
                return result;
            }
            Special_Term_Revision__c requested = [SELECT Id, Special_Term__c FROM Special_Term_Revision__c WHERE Id = :revisionId];
            if (body.termId != null && body.termId != requested.Special_Term__c) throw new SpecialTermRevisionService.RevisionException('Revision does not belong to the supplied Special Term.');
            if (action == 'activate') SpecialTermRevisionService.activate((Id) revisionId, body.approverEmail, body.reason, body.expectedLastModifiedAt);
            else if (action == 'approve-publish') SpecialTermRevisionService.approveDraftClausesAndActivate((Id) revisionId, body.approverEmail, body.reason, body.expectedLastModifiedAt, body.expectedVersionTimestamps);
            else if (action == 'rollback') SpecialTermRevisionService.rollback((Id) revisionId, body.reason, body.expectedLastModifiedAt);
            else throw new SpecialTermRevisionService.RevisionException('Action must be activate, approve-publish, rollback, or retire.');
            Special_Term_Revision__c revision = [SELECT Id, Special_Term__c, Status__c FROM Special_Term_Revision__c WHERE Id = :revisionId];
            result.success = true; result.revisionId = revision.Id; result.termId = revision.Special_Term__c; result.status = revision.Status__c;
            RestContext.response.statusCode = 200;
        } catch (Exception error) {
            result.success = false; result.revisionId = revisionId; result.message = error.getMessage();
            RestContext.response.statusCode = error instanceof SpecialTermRevisionService.RevisionException ? 400 : 409;
        }
        return result;
    }
}
