@RestResource(urlMapping='/fcos/master-contracts/v1/*')
global without sharing class MasterContractGenerationRest {
    private static void jsonResponse(Integer statusCode, Object body) {
        RestContext.response.statusCode = statusCode;
        RestContext.response.addHeader('Content-Type', 'application/json');
        RestContext.response.responseBody = Blob.valueOf(JSON.serialize(body));
    }

    @HttpGet
    global static void getStatus() {
        try {
            String contractKey = RestContext.request.params.get('contractKey');
            jsonResponse(200, MasterContractGenerationService.status(contractKey));
        } catch (Exception ex) {
            jsonResponse(400, new Map<String, Object>{ 'errorCode' => 'MASTER_CONTRACT_STATUS_FAILED', 'message' => ex.getMessage() });
        }
    }

    @HttpPost
    global static void postAction() {
        String uri = RestContext.request.requestURI == null ? '' : RestContext.request.requestURI.toLowerCase();
        try {
            if (uri.endsWith('/create')) {
                MasterContractGenerationService.CreateRequest request = (MasterContractGenerationService.CreateRequest) JSON.deserialize(
                    RestContext.request.requestBody.toString(), MasterContractGenerationService.CreateRequest.class
                );
                jsonResponse(200, MasterContractGenerationService.create(request));
                return;
            }
            if (uri.endsWith('/prices')) {
                MasterContractGenerationService.PriceRequest request = (MasterContractGenerationService.PriceRequest) JSON.deserialize(
                    RestContext.request.requestBody.toString(), MasterContractGenerationService.PriceRequest.class
                );
                jsonResponse(200, MasterContractGenerationService.applyPrice(request));
                return;
            }
            jsonResponse(404, new Map<String, Object>{ 'errorCode' => 'MASTER_CONTRACT_ACTION_NOT_FOUND', 'message' => 'Master Contract action is unavailable.' });
        } catch (Exception ex) {
            jsonResponse(400, new Map<String, Object>{ 'errorCode' => 'MASTER_CONTRACT_ACTION_FAILED', 'message' => ex.getMessage() });
        }
    }
}
