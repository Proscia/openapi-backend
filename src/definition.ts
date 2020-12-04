import { OpenAPIV3 } from 'openapi-types';
import * as SwaggerParser from '@apidevtools/swagger-parser';
import OpenAPISchemaValidator from 'openapi-schema-validator';
import * as _ from 'lodash';
import { type } from 'os';
import { Ajv } from 'ajv';

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
	private $refs: SwaggerParser.$Refs;

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
	
	/**
	 * Returns just the URI of a JSON $ref
	 * @param ref A JSON $ref string
	 */
	private static getRefUri(ref: string): string{
		return ref.substring(0, ref.indexOf('#'));
	}

	/**
	 * Gets the schemaKey used in Ajv for a URI
	 * @param ref A JSON $ref string
	 * @param parentUri the URI of the schema in which this $ref is used
	 */
	public getRefSchemaKey(ref: string, parentUri: string): string{
		let uri = OpenAPIDefinition.getRefUri(ref);
		if(uri === '') uri = parentUri;

		const schema = this.$refs.get(uri);
		for(let key in this.$refs.values()){
			if(schema === this.$refs.get(key)) return key;
		}
		throw new Error(`$ref path not found for: ${ref} (parentUri: '${parentUri}')`);
	}

	/**
	 * Recursively changes the Uris of $ref values in a schema to the refSchemaKeys used by Ajv 
	 * @param node a value within a schema object to alter
	 * @param parentUri the URI of the reference schema. Used for namespacing the ref string.
	 */
	private replaceUris(node: any, parentUri: string = ''): void{
		if(typeof(node) !== 'object') return;	
		for(let key of _.keys(node)){
			if(key === '$ref'){
				const ref = node[key] as string;
				const refSchemaKey = this.getRefSchemaKey(ref, parentUri);
				const uri = OpenAPIDefinition.getRefUri(ref);
				node[key] = `${refSchemaKey}${ref.substring(uri.length)}`;
			}else{
				this.replaceUris(node[key], parentUri);
			}
		}
	}

	/**
	 * Returns a schema with $ref URIs substituted for refSchemaKeys. Also dereferences a $ref at the root if it exists.
	 * This is necessary for Ajv to be able to dereference $refs witin the schema.
	 * @param ref a ref used in the definition document
	 */
	public getAjvSchema(schema: any): any {
		schema = _.cloneDeep(schema);
		let rootUri = '';
		if('$ref' in schema){
			rootUri = OpenAPIDefinition.getRefUri(schema.$ref);
			schema = this.$refs.get(schema.$ref);
		}
		this.replaceUris(schema, rootUri);
		return schema;
	}

	/**
	 * Adds reference schemas to Ajv so they $refs can be dereferenced.
	 * @param ajv Ajv instance which is being used to compile a schema
	 */
	public addRefSchemas(ajv: Ajv): void{
		_.forEach(this.$refs.values(), (refSchema, key) => ajv.addSchema(refSchema, key));
	}
}
