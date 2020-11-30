import { OpenAPIV3 } from 'openapi-types';
import * as SwaggerParser from '@apidevtools/swagger-parser';
import OpenAPISchemaValidator from 'openapi-schema-validator';
import * as _ from 'lodash';
import { type } from 'os';

// alias Document to OpenAPIV3.Document
export type Document = OpenAPIV3.Document;

export interface Options {
  definition: Document | string;
  strict?: boolean;
  quick?: boolean;
}

export class OpenAPIDefinition {
  public document: Document;
  public documentDereferenced: Document;
  public inputDocument: Document | string;
  public $refs: SwaggerParser.$Refs;

  public strict: boolean;
  public quick: boolean;

  /**
   * Creates an instance of OpenAPIBackend.
   *
   * @param {Options} opts - constructor options
   * @param {Document | string} opts.definition - the OpenAPI definition, file path or Document object
   * @param {boolean} opts.strict - strict mode, throw errors or warn on OpenAPI spec validation errors (default: false)
   * @param {boolean} opts.quick - quick startup, attempts to optimise startup; might break things (default: false)
   * @memberof OpenAPIBackend
   */
  constructor(opts: Options) {
    this.inputDocument = opts.definition;
    this.strict = opts.strict || false;
    this.quick = opts.quick || false;
  }

  /**
   * Loads the input document asynchronously and sets this.document
   *
   * @memberof OpenAPIBackend
   */
  public async loadDocument() {
    this.document = (await SwaggerParser.parse(this.inputDocument)) as Document;
    return this.document;
  }

  /**
   * Validates this.document, which is the parsed OpenAPI document. Throws an error if validation fails.
   *
   * @returns {Document} parsed document
   * @memberof OpenAPIBackend
   */
  public validateDefinition() {
    const validateOpenAPI = new OpenAPISchemaValidator({ version: 3 });
    const { errors } = validateOpenAPI.validate(this.document);
    if (errors.length) {
      const prettyErrors = JSON.stringify(errors, null, 2);
      throw new Error(`Document is not valid OpenAPI. ${errors.length} validation errors:\n${prettyErrors}`);
    }
    return this.document;
  }

  public async init() {
    try {
      // parse the document
      if (this.quick) {
        // in quick mode we don't care when the document is ready
        this.loadDocument();
      } else {
        await this.loadDocument();
      }

      if (!this.quick) {
        // validate the document
        this.validateDefinition();
      }

      // dereference the document into definition (make sure not to copy)
      this.documentDereferenced = (await SwaggerParser.dereference(
        _.cloneDeep(this.document || this.inputDocument),
      )) as Document;
      this.$refs = await SwaggerParser.resolve(_.cloneDeep(this.document || this.inputDocument));
    } catch (err) {
      if (this.strict) {
        // in strict-mode, fail hard and re-throw the error
        throw err;
      } else {
        // just emit a warning about the validation errors
        console.warn(err);
      }
    }
  }
}
