"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const Ajv = require("ajv");
const router_1 = require("./router");
const utils_1 = require("./utils");
const backend_1 = require("./backend");
var ValidationContext;
(function (ValidationContext) {
    ValidationContext["RequestBody"] = "requestBodyValidator";
    ValidationContext["Params"] = "paramsValidator";
    ValidationContext["Response"] = "responseValidator";
    ValidationContext["ResponseHeaders"] = "responseHeadersValidator";
})(ValidationContext = exports.ValidationContext || (exports.ValidationContext = {}));
/**
 * Returns a function that validates that a signed number is within the given bit range
 * @param {number} bits
 */
function getBitRangeValidator(bits) {
    const max = Math.pow(2, bits - 1);
    return (value) => value >= -max && value < max;
}
// Formats defined by the OAS
const defaultFormats = {
    int32: {
        // signed 32 bits
        type: 'number',
        validate: getBitRangeValidator(32),
    },
    int64: {
        // signed 64 bits (a.k.a long)
        type: 'number',
        validate: getBitRangeValidator(64),
    },
    float: {
        type: 'number',
        validate: () => true,
    },
    double: {
        type: 'number',
        validate: () => true,
    },
    byte: {
        // base64 encoded characters
        type: 'string',
        validate: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    },
    binary: {
        // any sequence of octets
        type: 'string',
        validate: () => true,
    },
    password: {
        // A hint to UIs to obscure input.
        type: 'string',
        validate: () => true,
    },
};
/**
 * Class that handles JSON schema validation
 *
 * @export
 * @class OpenAPIValidator
 */
class OpenAPIValidator {
    /**
     * Creates an instance of OpenAPIValidation
     *
     * @param opts - constructor options
     * @param {Document | string} opts.definition - the OpenAPI definition, file path or Document object
     * @param {boolean} opts.ajvOpts - default ajv constructor opts (default: { unknownFormats: 'ignore' })
     * @param {OpenAPIRouter} opts.router - passed instance of OpenAPIRouter. Will create own child if no passed
     * @memberof OpenAPIRequestValidator
     */
    constructor(opts) {
        this.definition = opts.definition;
        this.ajvOpts = Object.assign({ unknownFormats: 'ignore', nullable: true }, (opts.ajvOpts || {}));
        this.customizeAjv = opts.customizeAjv;
        // initalize router
        this.router = opts.router || new router_1.OpenAPIRouter({ definition: this.definition });
        // get defined api operations
        const operations = this.router.getOperations();
        // build request validation schemas for api operations
        this.requestValidators = {};
        operations.map(this.buildRequestValidatorsForOperation.bind(this));
        // build response validation schemas for api operations
        this.responseValidators = {};
        operations.map(this.buildResponseValidatorForOperation.bind(this));
        // build response validation schemas for api operations, per status code
        this.statusBasedResponseValidators = {};
        operations.map(this.buildStatusBasedResponseValidatorForOperation.bind(this));
        // build response header validation schemas for api operations
        this.responseHeadersValidators = {};
        operations.map(this.buildResponseHeadersValidatorForOperation.bind(this));
    }
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
    validateRequest(req, operation) {
        const result = { valid: true };
        result.errors = [];
        if (!operation) {
            operation = this.router.matchOperation(req);
        }
        else if (typeof operation === 'string') {
            operation = this.router.getOperation(operation);
        }
        if (!operation || !operation.operationId) {
            throw new Error(`Unknown operation`);
        }
        // get pre-compiled ajv schemas for operation
        const { operationId } = operation;
        const validators = this.getRequestValidatorsForOperation(operationId);
        // build a parameter object to validate
        const { params, query, headers, cookies, requestBody } = this.router.parseRequest(req, operation);
        // convert singular query parameters to arrays if specified as array in operation parametes
        if (query) {
            for (const [name, value] of _.entries(query)) {
                if (typeof value === 'string') {
                    const operationParameter = _.find(operation.parameters, { name, in: 'query' });
                    if (operationParameter) {
                        const { schema } = operationParameter;
                        if (schema && schema.type === 'array') {
                            query[name] = [value];
                        }
                    }
                }
            }
        }
        const parameters = _.omitBy({
            path: params,
            query,
            header: headers,
            cookie: cookies,
        }, _.isNil);
        if (typeof req.body !== 'object' && req.body !== undefined) {
            const payloadFormats = _.keys(_.get(operation, 'requestBody.content', {}));
            if (payloadFormats.length === 1 && payloadFormats[0] === 'application/json') {
                // check that JSON isn't malformed when the only payload format is JSON
                try {
                    JSON.parse(`${req.body}`);
                }
                catch (err) {
                    result.errors.push({
                        keyword: 'parse',
                        dataPath: '',
                        schemaPath: '#/requestBody',
                        params: [],
                        message: err.message,
                    });
                }
            }
        }
        if (typeof requestBody === 'object' || headers['content-type'] === 'application/json') {
            // include request body in validation if an object is provided
            parameters.requestBody = requestBody;
        }
        // validate parameters against each pre-compiled schema
        for (const validate of validators) {
            validate(parameters);
            if (validate.errors) {
                result.errors.push(...validate.errors);
            }
        }
        if (_.isEmpty(result.errors)) {
            // set empty errors array to null so we can check for result.errors truthiness
            result.errors = null;
        }
        else {
            // there were errors, set valid to false
            result.valid = false;
        }
        return result;
    }
    /**
     * Validates a response against a prebuilt Ajv validator and returns the result
     *
     * @param {*} res
     * @param {(Operation | string)} [operation]
     * @package {number} [statusCode]
     * @returns {ValidationResult}
     * @memberof OpenAPIRequestValidator
     */
    validateResponse(res, operation, statusCode) {
        const result = { valid: true };
        result.errors = [];
        const op = typeof operation === 'string' ? this.router.getOperation(operation) : operation;
        if (!op || !op.operationId) {
            throw new Error(`Unknown operation`);
        }
        const { operationId } = op;
        let validate;
        if (statusCode) {
            // use specific status code
            const validateMap = this.getStatusBasedResponseValidatorForOperation(operationId);
            if (validateMap) {
                validate = utils_1.default.findStatusCodeMatch(statusCode, validateMap);
            }
        }
        else {
            // match against all status codes
            validate = this.getResponseValidatorForOperation(operationId);
        }
        if (validate) {
            // perform validation against response
            validate(res);
            if (validate.errors) {
                result.errors.push(...validate.errors);
            }
        }
        else {
            // maybe we should warn about this? TODO: add option to enable / disable warnings
            // console.warn(`No validation matched for ${JSON.stringify({ operationId, statusCode })}`);
        }
        if (_.isEmpty(result.errors)) {
            // set empty errors array to null so we can check for result.errors truthiness
            result.errors = null;
        }
        else {
            // there were errors, set valid to false
            result.valid = false;
        }
        return result;
    }
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
    validateResponseHeaders(headers, operation, opts) {
        const result = { valid: true };
        result.errors = [];
        const op = typeof operation === 'string' ? this.router.getOperation(operation) : operation;
        if (!op || !op.operationId) {
            throw new Error(`Unknown operation`);
        }
        let setMatchType = opts && opts.setMatchType;
        const statusCode = opts && opts.statusCode;
        if (!setMatchType) {
            setMatchType = backend_1.SetMatchType.Any;
        }
        else if (!_.includes(Object.values(backend_1.SetMatchType), setMatchType)) {
            throw new Error(`Unknown setMatchType ${setMatchType}`);
        }
        const { operationId } = op;
        const validateMap = this.getResponseHeadersValidatorForOperation(operationId);
        if (validateMap) {
            let validateForStatus;
            if (statusCode) {
                validateForStatus = utils_1.default.findStatusCodeMatch(statusCode, validateMap);
            }
            else {
                validateForStatus = utils_1.default.findDefaultStatusCodeMatch(validateMap).res;
            }
            if (validateForStatus) {
                const validate = validateForStatus[setMatchType];
                if (validate) {
                    headers = _.mapKeys(headers, (value, headerName) => headerName.toLowerCase());
                    validate({ headers });
                    if (validate.errors) {
                        result.errors.push(...validate.errors);
                    }
                }
            }
        }
        if (_.isEmpty(result.errors)) {
            // set empty errors array to null so we can check for result.errors truthiness
            result.errors = null;
        }
        else {
            // there were errors, set valid to false
            result.valid = false;
        }
        return result;
    }
    /**
     * Get an array of request validator functions for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Ajv.ValidateFunction[]}
     * @memberof OpenAPIRequestValidator
     */
    getRequestValidatorsForOperation(operationId) {
        return this.requestValidators[operationId];
    }
    /**
     * Get Ajv options
     *
     * @param {ValidationContext} validationContext
     * @param {Ajv.Options} [opts={}]
     * @returns Ajv
     * @memberof OpenAPIValidator
     */
    getAjv(validationContext, opts = {}) {
        const ajvOpts = Object.assign(Object.assign({}, this.ajvOpts), opts);
        const ajv = new Ajv(ajvOpts);
        for (const [name, format] of Object.entries(defaultFormats)) {
            ajv.addFormat(name, format);
        }
        if (this.customizeAjv) {
            return this.customizeAjv(ajv, ajvOpts, validationContext);
        }
        return ajv;
    }
    /**
     * Compiles a schema with Ajv instance and handles circular references.
     *
     * @param ajv The Ajv instance
     * @param schema The schema to compile
     */
    static compileSchema(ajv, schema) {
        const decycledSchema = this.decycle(schema);
        return ajv.compile(decycledSchema);
    }
    /**
     * Produces a deep clone which replaces object reference cycles with JSONSchema refs.
     * This function is based on [cycle.js]{@link https://github.com/douglascrockford/JSON-js/blob/master/cycle.js}, which was referred by
     * the [MDN]{@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value}.
     * @param object An object for which to remove cycles
     */
    static decycle(object) {
        const objects = new WeakMap(); // object to path mappings
        return (function derez(value, path) {
            // The derez function recurses through the object, producing the deep copy.
            let oldPath; // The path of an earlier occurance of value
            let nu; // The new object or array
            // typeof null === "object", so go on if this value is really an object but not
            // one of the weird builtin objects.
            if (typeof value === 'object' &&
                value !== null &&
                !(value instanceof Boolean) &&
                !(value instanceof Date) &&
                !(value instanceof Number) &&
                !(value instanceof RegExp) &&
                !(value instanceof String)) {
                // If the value is an object or array, look to see if we have already
                // encountered it. If so, return a {"$ref":PATH} object. This uses an
                // ES6 WeakMap.
                oldPath = objects.get(value);
                if (oldPath !== undefined) {
                    return { $ref: oldPath };
                }
                // Otherwise, accumulate the unique value and its path.
                objects.set(value, path);
                // If it is an array, replicate the array.
                if (Array.isArray(value)) {
                    nu = [];
                    value.forEach((element, i) => {
                        nu[i] = derez(element, path + '/' + i);
                    });
                }
                else {
                    // If it is an object, replicate the object.
                    nu = {};
                    Object.keys(value).forEach((name) => {
                        nu[name] = derez(value[name], path + '/' + name);
                    });
                }
                return nu;
            }
            return value;
        })(object, '#');
    }
    /**
     * Builds Ajv request validation functions for an operation and registers them to requestValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildRequestValidatorsForOperation(operation) {
        if (!operation || !operation.operationId) {
            // no operationId, don't register a validator
            return;
        }
        const { operationId } = operation;
        // validator functions for this operation
        const validators = [];
        // schema for operation requestBody
        if (operation.requestBody) {
            const requestBody = operation.requestBody;
            const jsonbody = requestBody.content['application/json'];
            if (jsonbody && jsonbody.schema) {
                const requestBodySchema = {
                    title: 'Request',
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                        requestBody: jsonbody.schema,
                    },
                };
                requestBodySchema.required = [];
                if (_.keys(requestBody.content).length === 1) {
                    // if application/json is the only specified format, it's required
                    requestBodySchema.required.push('requestBody');
                }
                // add compiled params schema to schemas for this operation id
                const requestBodyValidator = this.getAjv(ValidationContext.RequestBody);
                validators.push(OpenAPIValidator.compileSchema(requestBodyValidator, requestBodySchema));
            }
        }
        // schema for operation parameters in: path,query,header,cookie
        const paramsSchema = {
            title: 'Request',
            type: 'object',
            additionalProperties: true,
            properties: {
                path: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {},
                    required: [],
                },
                query: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                    required: [],
                },
                header: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {},
                    required: [],
                },
                cookie: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {},
                    required: [],
                },
            },
            required: [],
        };
        // params are dereferenced here, no reference objects.
        const { parameters } = operation;
        if (parameters) {
            parameters.map((parameter) => {
                const param = parameter;
                const target = paramsSchema.properties[param.in];
                // Header params are case-insensitive according to https://tools.ietf.org/html/rfc7230#page-22, so they are
                // normalized to lower case and validated as such.
                const normalizedParamName = param.in === 'header' ? param.name.toLowerCase() : param.name;
                if (param.required) {
                    target.required = target.required || [];
                    target.required = _.uniq([...target.required, normalizedParamName]);
                    paramsSchema.required = _.uniq([...paramsSchema.required, param.in]);
                }
                target.properties = target.properties || {};
                if (param.content && param.content['application/json']) {
                    target.properties[normalizedParamName] = param.content['application/json'].schema;
                }
                else {
                    target.properties[normalizedParamName] = param.schema;
                }
            });
        }
        // add compiled params schema to requestValidators for this operation id
        const paramsValidator = this.getAjv(ValidationContext.Params, { coerceTypes: true });
        validators.push(OpenAPIValidator.compileSchema(paramsValidator, paramsSchema));
        this.requestValidators[operationId] = validators;
    }
    /**
     * Get response validator function for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Ajv.ValidateFunction}
     * @memberof OpenAPIRequestValidator
     */
    getResponseValidatorForOperation(operationId) {
        return this.responseValidators[operationId];
    }
    /**
     * Builds an ajv response validator function for an operation and registers it to responseValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildResponseValidatorForOperation(operation) {
        if (!operation || !operation.operationId) {
            // no operationId, don't register a validator
            return;
        }
        if (!operation.responses) {
            // operation has no responses, don't register a validator
            return;
        }
        const { operationId } = operation;
        const responseSchemas = [];
        _.mapKeys(operation.responses, (res, status) => {
            const response = res;
            if (response.content && response.content['application/json'] && response.content['application/json'].schema) {
                responseSchemas.push(response.content['application/json'].schema);
            }
            return null;
        });
        if (_.isEmpty(responseSchemas)) {
            // operation has no response schemas, don't register a validator
            return;
        }
        // compile the validator function and register to responseValidators
        const schema = { oneOf: responseSchemas };
        const responseValidator = this.getAjv(ValidationContext.Response);
        this.responseValidators[operationId] = OpenAPIValidator.compileSchema(responseValidator, schema);
    }
    /**
     * Get response validator function for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Object.<Ajv.ValidateFunction>}}
     * @memberof OpenAPIRequestValidator
     */
    getStatusBasedResponseValidatorForOperation(operationId) {
        return this.statusBasedResponseValidators[operationId];
    }
    /**
     * Builds an ajv response validator function for an operation and registers it to responseHeadersValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildStatusBasedResponseValidatorForOperation(operation) {
        if (!operation || !operation.operationId) {
            // no operationId, don't register a validator
            return;
        }
        if (!operation.responses) {
            // operation has no responses, don't register a validator
            return;
        }
        const { operationId } = operation;
        const responseValidators = {};
        const validator = this.getAjv(ValidationContext.Response);
        _.mapKeys(operation.responses, (res, status) => {
            const response = res;
            if (response.content && response.content['application/json'] && response.content['application/json'].schema) {
                const validateFn = response.content['application/json'].schema;
                responseValidators[status] = OpenAPIValidator.compileSchema(validator, validateFn);
            }
            return null;
        });
        this.statusBasedResponseValidators[operationId] = responseValidators;
    }
    /**
     * Get response validator function for an operation by operationId
     *
     * @param {string} operationId
     * @returns {Object.<Object.<Ajv.ValidateFunction>>}}
     * @memberof OpenAPIRequestValidator
     */
    getResponseHeadersValidatorForOperation(operationId) {
        return this.responseHeadersValidators[operationId];
    }
    /**
     * Builds an ajv response validator function for an operation and registers it to responseHeadersValidators
     *
     * @param {Operation} operation
     * @memberof OpenAPIRequestValidator
     */
    buildResponseHeadersValidatorForOperation(operation) {
        if (!operation || !operation.operationId) {
            // no operationId, don't register a validator
            return;
        }
        if (!operation.responses) {
            // operation has no responses, don't register a validator
            return;
        }
        const { operationId } = operation;
        const headerValidators = {};
        const validator = this.getAjv(ValidationContext.ResponseHeaders, { coerceTypes: true });
        _.mapKeys(operation.responses, (res, status) => {
            const response = res;
            const validateFns = {};
            const properties = {};
            const required = [];
            _.mapKeys(response.headers, (h, headerName) => {
                const header = h;
                headerName = headerName.toLowerCase();
                if (header.schema) {
                    properties[headerName] = header.schema;
                    required.push(headerName);
                }
                return null;
            });
            validateFns[backend_1.SetMatchType.Any] = OpenAPIValidator.compileSchema(validator, {
                type: 'object',
                properties: {
                    headers: {
                        type: 'object',
                        additionalProperties: true,
                        properties,
                        required: [],
                    },
                },
            });
            validateFns[backend_1.SetMatchType.Superset] = OpenAPIValidator.compileSchema(validator, {
                type: 'object',
                properties: {
                    headers: {
                        type: 'object',
                        additionalProperties: true,
                        properties,
                        required,
                    },
                },
            });
            validateFns[backend_1.SetMatchType.Subset] = OpenAPIValidator.compileSchema(validator, {
                type: 'object',
                properties: {
                    headers: {
                        type: 'object',
                        additionalProperties: false,
                        properties,
                        required: [],
                    },
                },
            });
            validateFns[backend_1.SetMatchType.Exact] = OpenAPIValidator.compileSchema(validator, {
                type: 'object',
                properties: {
                    headers: {
                        type: 'object',
                        additionalProperties: false,
                        properties,
                        required,
                    },
                },
            });
            headerValidators[status] = validateFns;
            return null;
        });
        this.responseHeadersValidators[operationId] = headerValidators;
    }
}
exports.OpenAPIValidator = OpenAPIValidator;
//# sourceMappingURL=validation.js.map