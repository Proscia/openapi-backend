"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const bath_es5_1 = require("bath-es5");
const cookie = require("cookie");
const qs_1 = require("qs");
/**
 * Class that handles routing
 *
 * @export
 * @class OpenAPIRouter
 */
class OpenAPIRouter {
    /**
     * Creates an instance of OpenAPIRouter
     *
     * @param opts - constructor options
     * @param {Document} opts.definition - the OpenAPI definition, file path or Document object
     * @param {string} opts.apiRoot - the root URI of the api. all paths are matched relative to apiRoot
     * @memberof OpenAPIRouter
     */
    constructor(opts) {
        this.definition = opts.definition;
        this.apiRoot = opts.apiRoot || '/';
    }
    matchOperation(req, strict) {
        // normalize request for matching
        req = this.normalizeRequest(req);
        // if request doesn't match apiRoot, throw 404
        if (!req.path.startsWith(this.apiRoot)) {
            if (strict) {
                throw Error('404-notFound: no route matches request');
            }
            else {
                return undefined;
            }
        }
        // get relative path
        const normalizedPath = this.normalizePath(req.path);
        // get all operations matching exact path
        const exactPathMatches = _.filter(this.getOperations(), ({ path }) => path === normalizedPath);
        // check if there's one with correct method and return if found
        const exactMatch = _.find(exactPathMatches, ({ method }) => method === req.method);
        if (exactMatch) {
            return exactMatch;
        }
        // check with path templates
        const templatePathMatches = _.filter(this.getOperations(), ({ path }) => {
            // convert openapi path template to a regex pattern i.e. /{id}/ becomes /[^/]+/
            const pathPattern = `^${path.replace(/\{.*?\}/g, '[^/]+')}$`;
            return Boolean(normalizedPath.match(new RegExp(pathPattern, 'g')));
        });
        // if no operations match the path, throw 404
        if (!templatePathMatches.length) {
            if (strict) {
                throw Error('404-notFound: no route matches request');
            }
            else {
                return undefined;
            }
        }
        // find matching operation
        const match = _.chain(templatePathMatches)
            // order matches by length (specificity)
            .orderBy((op) => op.path.replace(RegExp(/\{.*?\}/g), '').length, 'desc')
            // then check if one of the matched operations matches the method
            .find(({ method }) => method === req.method)
            .value();
        if (!match) {
            if (strict) {
                throw Error('405-methodNotAllowed: this method is not registered for the route');
            }
            else {
                return undefined;
            }
        }
        return match;
    }
    /**
     * Flattens operations into a simple array of Operation objects easy to work with
     *
     * @returns {Operation[]}
     * @memberof OpenAPIRouter
     */
    getOperations() {
        const paths = _.get(this.definition, 'paths', {});
        return _.chain(paths)
            .entries()
            .flatMap(([path, pathBaseObject]) => {
            const methods = _.pick(pathBaseObject, ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
            return _.entries(methods).map(([method, operation]) => {
                const op = operation;
                return Object.assign(Object.assign({}, op), { path,
                    method, 
                    // append the path base object's parameters to the operation's parameters
                    parameters: [
                        ...(op.parameters || []),
                        ...(pathBaseObject.parameters || []),
                    ], 
                    // operation-specific security requirement override global requirements
                    security: op.security || this.definition.security || [] });
            });
        })
            .value();
    }
    /**
     * Gets a single operation based on operationId
     *
     * @param {string} operationId
     * @returns {Operation}
     * @memberof OpenAPIRouter
     */
    getOperation(operationId) {
        return _.find(this.getOperations(), { operationId });
    }
    /**
     * Normalises request:
     * - http method to lowercase
     * - path leading slash 👍
     * - path trailing slash 👎
     * - path query string 👎
     *
     * @export
     * @param {Request} req
     * @returns {Request}
     */
    normalizeRequest(req) {
        return Object.assign(Object.assign({}, req), { path: (req.path || '')
                .trim()
                .split('?')[0] // remove query string
                .replace(/\/+$/, '') // remove trailing slash
                .replace(/^\/*/, '/'), method: req.method.trim().toLowerCase() });
    }
    /**
     * Normalises path for matching: strips apiRoot prefix from the path.
     *
     * @export
     * @param {string} path
     * @returns {string}
     */
    normalizePath(path) {
        return path.replace(new RegExp(`^${this.apiRoot}/?`), '/');
    }
    /**
     * Parses and normalizes a request
     * - parse json body
     * - parse query string
     * - parse cookies from headers
     * - parse path params based on uri template
     *
     * @export
     * @param {Request} req
     * @param {string} [patbh]
     * @returns {ParsedRequest}
     */
    parseRequest(req, operation) {
        let requestBody = req.body;
        if (req.body && typeof req.body !== 'object') {
            try {
                // attempt to parse json
                requestBody = JSON.parse(req.body.toString());
            }
            catch (_a) {
                // suppress json parsing errors
                // we will emit error if validation requires it later
            }
        }
        // header keys are converted to lowercase, so Content-Type becomes content-type
        const headers = _.mapKeys(req.headers, (val, header) => header.toLowerCase());
        // parse cookie from headers
        const cookieHeader = headers['cookie'];
        const cookies = cookie.parse(_.flatten([cookieHeader]).join('; '));
        // get query string from path
        const queryString = req.path.split('?')[1];
        const query = typeof req.query === 'object' ? _.cloneDeep(req.query) : qs_1.parse(queryString);
        // normalize
        req = this.normalizeRequest(req);
        let params = {};
        if (operation) {
            // get relative path
            const normalizedPath = this.normalizePath(req.path);
            // parse path params if path is given
            const pathParams = bath_es5_1.default(operation.path);
            params = pathParams.params(normalizedPath) || {};
            // parse query parameters with specified style for parameter
            for (const queryParam in query) {
                if (query[queryParam]) {
                    const parameter = _.find(operation.parameters || [], {
                        name: queryParam,
                        in: 'query',
                    });
                    if (parameter) {
                        if (parameter.content && parameter.content['application/json']) {
                            query[queryParam] = JSON.parse(query[queryParam]);
                        }
                        else if (parameter.explode === false && queryString) {
                            let commaQueryString = queryString;
                            if (parameter.style === 'spaceDelimited') {
                                commaQueryString = commaQueryString.replace(/\ /g, ',').replace(/\%20/g, ',');
                            }
                            if (parameter.style === 'pipeDelimited') {
                                commaQueryString = commaQueryString.replace(/\|/g, ',').replace(/\%7C/g, ',');
                            }
                            // use comma parsing e.g. &a=1,2,3
                            const commaParsed = qs_1.parse(commaQueryString, { comma: true });
                            query[queryParam] = commaParsed[queryParam];
                        }
                    }
                }
            }
        }
        return Object.assign(Object.assign({}, req), { params,
            headers,
            query,
            cookies,
            requestBody });
    }
}
exports.OpenAPIRouter = OpenAPIRouter;
//# sourceMappingURL=router.js.map