@RestResource(urlMapping='/fcos/special-term-clauses/*')
global without sharing class SpecialTermClausePublicationRest {
    global class ErrorResponse {
        public Boolean success = false;
        public String clauseId;
        public String code;
        public String message;
    }

    private static List<String> pathParts() {
        List<String> parts = RestContext.request.requestURI.split('/');
        for (Integer index = 0; index < parts.size(); index++) {
            if (parts[index] == 'special-term-clauses' && index + 2 < parts.size()) {
                return new List<String>{ parts[index + 1], parts[index + 2] };
            }
        }
        return new List<String>();
    }

    private static void writeJson(Object value) {
        RestContext.response.addHeader('Content-Type', 'application/json');
        RestContext.response.responseBody = Blob.valueOf(JSON.serialize(value));
    }

    private static void failure(String clauseId, Exception error) {
        ErrorResponse result = new ErrorResponse();
        result.clauseId = clauseId;
        result.code = error instanceof SpecialTermClausePublicationService.PublicationException
            ? 'SPECIAL_TERMS_GLOBAL_PUBLICATION_REJECTED'
            : 'SPECIAL_TERMS_GLOBAL_PUBLICATION_FAILED';
        result.message = error.getMessage();
        RestContext.response.statusCode = error instanceof SpecialTermClausePublicationService.PublicationException ? 409 : 500;
        writeJson(result);
    }

    @HttpPost
    global static void execute() {
        List<String> path = pathParts();
        String clauseId = path.isEmpty() ? null : path[0];
        String action = path.size() > 1 ? path[1] : null;
        try {
            if (String.isBlank(clauseId)) throw new SpecialTermClausePublicationService.PublicationException('Clause is required.');
            if (action == 'publication-preview') {
                SpecialTermClausePublicationService.PreviewResult result = SpecialTermClausePublicationService.preview((Id) clauseId);
                RestContext.response.statusCode = 200;
                writeJson(result);
                return;
            }
            if (action == 'publish-everywhere') {
                String payload = RestContext.request.requestBody == null ? '' : RestContext.request.requestBody.toString();
                SpecialTermClausePublicationService.PublishRequest body = String.isBlank(payload)
                    ? new SpecialTermClausePublicationService.PublishRequest()
                    : (SpecialTermClausePublicationService.PublishRequest) JSON.deserialize(payload, SpecialTermClausePublicationService.PublishRequest.class);
                SpecialTermClausePublicationService.PublishResult result = SpecialTermClausePublicationService.publish((Id) clauseId, body);
                RestContext.response.statusCode = 200;
                writeJson(result);
                return;
            }
            throw new SpecialTermClausePublicationService.PublicationException('Action must be publication-preview or publish-everywhere.');
        } catch (Exception error) {
            failure(clauseId, error);
        }
    }
}
