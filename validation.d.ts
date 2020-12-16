import * as Ajv from 'ajv';
import { OpenAPIV3 } from 'openapi-types';
import { OpenAPIRouter, Request, Operation } from './router';
import { SetMatchType } from './backend';
declare type Document = OpenAPIV3.Document;
/**
 * The output object for validationRequest. Contains the results for validation
 *
 * @export
 * @interface ValidationStatus
 */
export interface ValidationResult {
    valid: boolean;
    errors?: Ajv.ErrorObject[] | null;
}
interface ResponseHeadersValidateFunctionMap {
    [statusCode: string]: {
        [setMatchType: string]: Ajv.ValidateFunction;
    };
}
interface StatusBasedResponseValidatorsFunctionMap {
    [statusCode: string]: Ajv.ValidateFunction;
}
interface ResponseValidatorsFunctionMap {
    [operationId: string]: StatusBasedResponseValidatorsFunctionMap;
}
export declare enum ValidationContext {
    RequestBody = "requestBodyValidator",
    Params = "paramsValidator",
    Response = "responseValidator",
    ResponseHeaders = "responseHeadersValidator"
}
export declare type AjvCustomizer = (originalAjv: Ajv.Ajv, ajvOpts: Ajv.Options, validationContext: ValidationContext) => Ajv.Ajv;
/**
 * Class that handles JSON schema validation
 *
 * @export
 * @class OpenAPIValidator
 */
export declare class OpenAPIValidator {
    definition: Document;
    ajvOpts: Ajv.Options;
    customizeAjv: AjvCustomizer | undefined;
    requestValidators: {
        [operationId: string]: Ajv.ValidateFunction[];
    };
    responseValidators: {
        [operationId: string]: Ajv.ValidateFunction;
    };
    statusBasedResponseValidators: ResponseValidatorsFunctionMap;
    responseHeadersValidators: {
        [operationId: string]: ResponseHeadersValidateFunctionMap;
    };
    router: OpenAPIRouter;
    /**
     * Creates an instance of OpenAPIValidation
     *
     * @param opts - constructor options
     * @param {Document | string} opts.definition - the OpenAPI definition, file path or Document object
     * @param {boolean} opts.ajvOpts - default ajv constructor opts (default: { unknownFormats: 'ignore' })
     * @param {OpenAPIRouter} opts.router - passed instance of OpenAPIRouter. Will create own child if no passed
     * @memberof OpenAPIRequestValidator
     */
    constructor(opts: {
        definition: Document;
        ajvOpts?: Ajv.Options;
        router?: OpenAPIRouter;
        customizeAjv?: AjvCustomizer;
    });
    /**
     * Validates a request against prebuilt Ajv validators and returns the validation result.
     *
     * The method will first match the request to an API operation and use the pre-compiled Ajv validation schema to
     * validate it.
     *
     * @param {Request} req - request to validate
     * @param {(Operation | string)} operation - operation to validate against
     * @returns {ValidationResult}
     * @memberof OpenAPIRequestValidator
     */
    validateRequest(req: Request, operation?: Operation | string): ValidationResult;
    /**
     * Validates a response against a prebuilt Ajv validator and returns the result
     *
     * @param {*} res
     * @param {(Operation | string)} [operation]
     * @package {number} [statusCode]
     * @returns {ValidationResult}
     * @memberof OpenAPIRequestValidator
     */
    validateResponse(res: any, operation: Operation | string, statusCode?: number): ValidationResult;
    /**
     * Validates response headers against a prebuilt Ajv validator and returns the result
     *
     * @param {*} headers
     * @param {(Operation | string)} [operation]
     * @param {number} [opts.statusCode]
     * @param {SetMatchType} [opts.setMatchType] - one of 'any', 'superset', 'subset', 'exact'
     * @returns {ValidationResult}
     * @memberof OpenAPIRequestValidator
     */
    validateResponseHeaders(headers: any, operation: Operation | string, opts?: {
        statusCode?: number;
        setMatchType?: SetMatchType;
    }): ValidationResult;
    /**
     * Get an array of request validator functions for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Ajv.ValidateFunction[]}
     * @memberof OpenAPIRequestValidator
     */
    getRequestValidatorsForOperation(operationId: string): Ajv.ValidateFunction[];
    /**
     * Get Ajv options
     *
     * @param {ValidationContext} validationContext
     * @param {Ajv.Options} [opts={}]
     * @returns Ajv
     * @memberof OpenAPIValidator
     */
    getAjv(validationContext: ValidationContext, opts?: Ajv.Options): Ajv.Ajv;
    /**
     * Compiles a schema with Ajv instance and handles circular references.
     *
     * @param ajv The Ajv instance
     * @param schema The schema to compile
     */
    private static compileSchema;
    /**
     * Produces a deep clone which replaces object reference cycles with JSONSchema refs.
     * This function is based on [cycle.js]{@link https://github.com/douglascrockford/JSON-js/blob/master/cycle.js}, which was referred by
     * the [MDN]{@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value}.
     * @param object An object for which to remove cycles
     */
    private static decycle;
    /**
     * Builds Ajv request validation functions for an operation and registers them to requestValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildRequestValidatorsForOperation(operation: Operation): void;
    /**
     * Get response validator function for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Ajv.ValidateFunction}
     * @memberof OpenAPIRequestValidator
     */
    getResponseValidatorForOperation(operationId: string): Ajv.ValidateFunction;
    /**
     * Builds an ajv response validator function for an operation and registers it to responseValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildResponseValidatorForOperation(operation: Operation): void;
    /**
     * Get response validator function for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Object.<Ajv.ValidateFunction>}}
     * @memberof OpenAPIRequestValidator
     */
    getStatusBasedResponseValidatorForOperation(operationId: string): StatusBasedResponseValidatorsFunctionMap;
    /**
     * Builds an ajv response validator function for an operation and registers it to responseHeadersValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildStatusBasedResponseValidatorForOperation(operation: Operation): void;
    /**
     * Get response validator function for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Object.<Object.<Ajv.ValidateFunction>>}}
     * @memberof OpenAPIRequestValidator
     */
    getResponseHeadersValidatorForOperation(operationId: string): ResponseHeadersValidateFunctionMap;
    /**
     * Builds an ajv response validator function for an operation and registers it to responseHeadersValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildResponseHeadersValidatorForOperation(operation: Operation): void;
}
export {};
