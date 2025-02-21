
import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IBinaryData,
	IBinaryKeyData,
} from 'n8n-workflow';
import { PDFDocument } from 'pdf-lib';

const BINARY_ENCODING = 'base64';

export class PDFForm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDF Form',
		name: 'pdfForm',
		group: ['transform'],
		icon:'file:pdf.svg',
		version: 1,
		description: 'Extract and map PDF form fields',
		defaults: {
			name: 'PDF Form',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Extract Fields',
						value: 'extractFields',
					},
					{
						name: 'Map Fields',
						value: 'mapFields',
					},
				],
				default: 'extractFields',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the PDF file',
			},
			{
				displayName: 'Extract Fields First',
				name: 'extractFields',
				type: 'notice',
				displayOptions: {
					show: {
						operation: ['mapFields'],
					},
				},
				default: '',
				description:
					'Use Extract Fields operation first to get the field names, then use them here for mapping',
			},
			{
				displayName: 'Output Filename',
				name: 'outputFilename',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['mapFields'],
					},
				},
				description: 'Name of the output PDF file. Leave empty to use input filename',
			},
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'fixedCollection',
				placeholder: 'Map Fields',
				typeOptions: {
					multipleValues: true,
				},
				displayOptions: {
					show: {
						operation: ['mapFields'],
					},
				},
				default: {},
				options: [
					{
						name: 'fieldValues',
						displayName: 'Field',
						values: [
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: '',
								description: 'Name of the PDF form field',
							},
							{
								displayName: 'Value',
								name: 'fieldValue',
								type: 'string',
								default: '',
								description: 'Value to set for the field',
							},
						],
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;

				// Get binary data
				if (!items[i].binary) {
					throw new NodeOperationError(this.getNode(), 'No binary data exists on item!');
				}

				const binaryData = items[i].binary?.[binaryPropertyName];
				if (!binaryData) {
					throw new NodeOperationError(
						this.getNode(),
						`No binary data property "${binaryPropertyName}" exists on item!`,
					);
				}

				// Convert base64 to buffer
				const pdfBuffer = Buffer.from(binaryData.data, BINARY_ENCODING);
				const pdfDoc = await PDFDocument.load(pdfBuffer);
				const form = pdfDoc.getForm();
				const fields = form.getFields();

				if (operation === 'extractFields') {
					// Extract field information from PDF
					const fieldInfo = fields.map((field, index) => {
						const info: any = {
							index: index + 1,
							name: field.acroField.T(),
							type: field.constructor.name,
						};

						try {
							// Handle different field types
							// @ts-ignore
							if (field instanceof PDFDocument.PDFTextField) {
								// @ts-ignore
								info.value = field.getText();
								// @ts-ignore
							} else if (field instanceof PDFDocument.PDFCheckBox) {
								// @ts-ignore
								info.value = field.isChecked();
								// @ts-ignore
							} else if (field instanceof PDFDocument.PDFRadioGroup) {
								// @ts-ignore
								info.value = field.getSelected();
								// @ts-ignore
							} else if (field instanceof PDFDocument.PDFDropdown) {
								// @ts-ignore
								info.value = field.getSelected();
							} else {
								info.value = null;
							}
						} catch (error) {
							info.value = null;
						}

						return info;
					});

					returnData.push({
						json: {
							totalFields: fields.length,
							fields: fieldInfo,
							fieldNames: fields.map((field) => field.getName()),
						}
					});
				} else if (operation === 'mapFields') {
					const fieldValues = this.getNodeParameter('fields.fieldValues', i, []) as Array<{
						fieldName: string;
						fieldValue: string;
					}>;

					const outputFilename = this.getNodeParameter('outputFilename', i, '') as string;

					// Map fields to their values from properties
					for (const { fieldName, fieldValue } of fieldValues) {
						const field = form.getField(fieldName);
						if (field) {
							try {
								// @ts-ignore
								field.setText(fieldValue);
							} catch (error) {
								console.error(`Error setting field ${fieldName}:`, error);
							}
						}
					}

					// Flatten all form fields
					form.flatten();

					// Save the modified PDF with flattened fields
					const modifiedPdfBytes = await pdfDoc.save({
						addDefaultPage: false,
						useObjectStreams: true,
					});

					// Convert to base64
					const modifiedPdfBase64 = Buffer.from(modifiedPdfBytes).toString('base64');

					const binaryData: IBinaryData = {
						data: modifiedPdfBase64,
						mimeType: 'application/pdf',
						fileName: outputFilename,
						fileExtension: 'pdf',
						fileSize: modifiedPdfBytes.length.toString(),
					};

					const binaryKeyData: IBinaryKeyData = {
						[binaryPropertyName]: binaryData,
					};

					returnData.push({
						binary: binaryKeyData,
						json: {
							success: true,
							totalFields: fieldValues.length,
							mappedFields: fieldValues.map((f) => ({
								name: f.fieldName,
								value: f.fieldValue,
							})),
						},
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
						},
						binary: items[i].binary,
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}