/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.generate/licenses/BSD-3-Clause
 */
import * as os from "os";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { join } from "path";

//@ts-ignore
import * as ConfigData from "../../../../src_config/metadata_field_generate.json";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("@shuntaro/sfdx-metadata-generator", "metadata_field_generate");

export default class generate extends SfdxCommand {
  public static description = messages.getMessage("commandDescription");

  public static examples = messages.getMessage("examples").split(os.EOL);

  public static args = [{ name: "file" }];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    input: flags.string({
      char: "i",
      description: messages.getMessage("inputFlagDescription"),
    }),
    outputdir: flags.string({
      char: "o",
      description: messages.getMessage("outputdirFlagDescription"),
    }),
    updates: flags.boolean({
      char: "u",
      description: messages.getMessage("updatesFlagDescription"),
    }),
    delimiter: flags.string({
      char: "d",
      description: messages.getMessage("delimiterFlagDescription"),
    }),
    picklistdelimiter: flags.string({
      char: "p",
      description: messages.getMessage("picklistDelimiterFlagDescription"),
    }),
  };

  // Comment this out if your command does not require an generate username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub generate username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  private static xmlSetting = ConfigData.xmlSetting;
  private static defaultValues = ConfigData.defaultValues;
  private static isRequired = ConfigData.isRequired;
  private static options = ConfigData.options;
  private static indentationLength = ConfigData.indentationLength;
  private static fieldExtension = ConfigData.fieldExtension;
  private static delimiter = ConfigData.delimiter;
  private static picklistDelimiter = ConfigData.picklistDelimiter;
  private static tagNames = ConfigData.tagNames;

  private static validationResults = [];
  private static successResults = [];
  private static failureResults = [];
  private static metaInfo = [];

  public async run(): Promise<AnyJson> {
    if (!existsSync(this.flags.input)) {
      throw new SfError(messages.getMessage("errorPathOfInput") + this.flags.input);
    }
    if (!existsSync(this.flags.outputdir)) {
      throw new SfError(messages.getMessage("errorPathOfOutput") + this.flags.outputdir);
    }
    if (this.flags.delimiter === undefined) {
      this.flags.delimiter = generate.delimiter;
    }
    if (this.flags.picklistDelimiter === undefined) {
      this.flags.picklistDelimiter = generate.picklistDelimiter;
    }
    const csv = readFileSync(this.flags.input, {
      encoding: "utf8",
    })
      .toString()
      .split("\n")
      .map((e) => e.trim())
      .map((e) => e.split(this.flags.delimiter).map((e) => e.trim()));

    const header = csv[0];
    for (let rowIndex = 1; rowIndex < csv.length; rowIndex++) {
      if (csv[rowIndex].length < header.length) {
        continue;
      }

      //generates metadata for each row
      let metaStr = this.getMetaStr(csv, rowIndex, header);

      if (generate.validationResults.length > 0) {
        continue;
      }

      const indexOfFullName = header.indexOf("fullName");
      generate.metaInfo.push({ fullName: csv[rowIndex][indexOfFullName], metaStr: metaStr });
      generate.successResults.push({
        FULLNAME: csv[rowIndex][indexOfFullName] + "." + generate.fieldExtension,
        PATH: join(this.flags.outputdir, csv[rowIndex][indexOfFullName] + "." + generate.fieldExtension).replace("//", "/"),
      });
    }
    if (generate.validationResults.length > 0) {
      this.showValidationErrorMessages();
    } else {
      this.saveMetaData();
      this.showFailureResults();
    }

    // Return an object to be displayed with --json*/
    return { input: this.flags.input };
  }

  private getMetaStr(csv: string[][], rowIndex: number, header: string[]) {
    let row = csv[rowIndex];
    const indexOfType = header.indexOf("type");
    let tagStrs = [];
    let metaStr =
      '<?xml version="' +
      generate.xmlSetting.version +
      '" encoding="' +
      generate.xmlSetting.encoding +
      '"?>\n<CustomField xmlns="' +
      generate.xmlSetting.xmlns +
      '">';
    const type = row[indexOfType];
    const colIndex = indexOfType + 1;

    if (!generate.options.type.includes(type)) {
      this.pushValidationResult("Row" + rowIndex + "Col" + colIndex, messages.getMessage("validationTypeOptions") + generate.options.type.toString());
    }

    for (const tag in generate.defaultValues[type]) {
      const indexOfTag = header.indexOf(tag);

      // dose not include tag at the header and the tag is not required
      if (indexOfTag === -1 && generate.isRequired[type][tag] === null) {
        continue;
      }

      //validates inputs
      if (!this.isValidInputs(tag, row, header, rowIndex)) {
        continue;
      }

      // when not applicable tag
      if (generate.isRequired[type][tag] === null && generate.defaultValues[type][tag] === null) {
        continue;
      }
      // to omit tag that dosent need to be xml tag if blank
      if (!generate.isRequired[type][tag] && generate.defaultValues[type][tag] === null && (indexOfTag === -1 || row[indexOfTag] === "")) {
        continue;
      }

      if (indexOfTag !== -1) {
        // convert special characters in the html form
        row[indexOfTag] = this.convertSpecialChars(row[indexOfTag]);

        // format boolean string in a xml format
        this.formatBoolean(tag, row, indexOfTag);
      }

      let tagStr = null;
      if (row[indexOfTag] != "") {
        tagStr = "<" + tag + ">" + row[indexOfTag] + "</" + tag + ">";
      } else if (generate.defaultValues[type][tag] !== null) {
        tagStr = "<" + tag + ">" + generate.defaultValues[type][tag] + "</" + tag + ">";
      }
      tagStrs.push(tagStr);
    }

    if (row[indexOfType] === "Picklist" || row[indexOfType] === "MultiselectPicklist") {
      tagStrs.push(this.getPicklistMetaStr(row, header, rowIndex));
    } else if (row[indexOfType] === "Summary") {
      tagStrs.push(this.getSummaryFilterItemsMetaStr(row, header, rowIndex));
    }

    tagStrs = tagStrs.filter((e) => {
      return e !== null;
    });
    tagStrs.sort();
    metaStr += "\n" + this.getIndentation(generate.indentationLength) + tagStrs.join("\n" + this.getIndentation(generate.indentationLength));
    metaStr += "\n</CustomField>";
    return metaStr;
  }

  private getPicklistMetaStr(row: string[], header: string[], rowIndex: number): string {
    const idxOfPicklistFullName = header.indexOf("picklistFullName");
    const idxOfPicklistLabel = header.indexOf("picklistLabel");
    const inputPicklistFullName = row[idxOfPicklistFullName];
    const inputPicklistLabel = row[idxOfPicklistLabel];
    let picklistValueStr = "";
    let picklistMetaStr =
      "<valueSet>\n" +
      this.getIndentation(2 * generate.indentationLength) +
      "<valueSetDefinition>\n" +
      this.getIndentation(3 * generate.indentationLength) +
      "<sorted>false</sorted>";
    const picklistDefaultStr = "<default>false</default>";
    let picklistValues = [];
    const picklistFullNames = inputPicklistFullName.split(this.flags.picklistDelimiter);
    const picklistLabels = inputPicklistLabel.split(this.flags.picklistDelimiter);

    if (!this.isValidInputsForPicklist(picklistFullNames, picklistLabels, header, rowIndex)) {
      return picklistMetaStr;
    }

    for (let idx = 0; idx < picklistFullNames.length; idx++) {
      picklistFullNames[idx] = this.convertSpecialChars(picklistFullNames[idx]);
      picklistLabels[idx] = this.convertSpecialChars(picklistLabels[idx]);
      let picklistFullNameStr = "<fullName>" + picklistFullNames[idx] + "</fullName>";
      let picklistLabelStr = "<label>" + picklistLabels[idx] + "</label>";
      let eachPicklistMetaStr = "<value>\n" + this.getIndentation(4 * generate.indentationLength);
      eachPicklistMetaStr += [picklistFullNameStr, picklistDefaultStr, picklistLabelStr].join(
        "\n" + this.getIndentation(4 * generate.indentationLength)
      );
      eachPicklistMetaStr += "\n" + this.getIndentation(3 * generate.indentationLength) + "</value>";
      picklistValues[idx] = eachPicklistMetaStr;
    }
    picklistValueStr = picklistValues.join("\n" + this.getIndentation(3 * generate.indentationLength));
    picklistMetaStr +=
      "\n" +
      this.getIndentation(3 * generate.indentationLength) +
      picklistValueStr +
      "\n" +
      this.getIndentation(2 * generate.indentationLength) +
      "</valueSetDefinition>\n" +
      this.getIndentation(generate.indentationLength) +
      "</valueSet>";
    return picklistMetaStr;
  }

  private getSummaryFilterItemsMetaStr(row: string[], header: string[], rowIndex: number): string {
    const idxOfField = header.indexOf("summaryFilterItemsField");
    const idxOfOperation = header.indexOf("summaryFilterItemsOperation");
    const idxOfValue = header.indexOf("summaryFilterItemsValue");
    const inputField = row[idxOfField];
    const inputOperation = row[idxOfOperation];
    const inputValue = row[idxOfValue];

    let summaryFilterItemsMetaStr = "<summaryFilterItems>\n" + this.getIndentation(2 * generate.indentationLength);

    // when there are no summaryFilterItems columns
    if ((idxOfField === -1 && idxOfOperation === -1 && idxOfValue === -1) || (inputField === "" && inputField === "" && inputValue === "")) {
      return null;
    }
    if (!this.isValidInputsForSummaryFilterItems(inputField, inputOperation, inputValue, header, rowIndex)) {
      return null;
    }

    summaryFilterItemsMetaStr += "<field>" + inputField + "</field>" + this.getIndentation(2 * generate.indentationLength);
    summaryFilterItemsMetaStr += "<operation>" + inputOperation + "</operation>" + this.getIndentation(2 * generate.indentationLength);
    summaryFilterItemsMetaStr += "<value>" + inputValue + "</value>" + this.getIndentation(generate.indentationLength);

    summaryFilterItemsMetaStr += "</summaryFilterItems>";
    return summaryFilterItemsMetaStr;
  }

  private isValidInputs(tag: string, row: string[], header: string[], rowIndex: number): boolean {
    const indexOfType = header.indexOf("type");
    const type = row[indexOfType];
    const indexOfTag = header.indexOf(tag);

    const regExpForOneChar = /^[a-zA-Z]/;
    const regExpForSnakeCase = /^[a-zA-Z][0-9a-zA-Z_]+[a-zA-Z]$/;
    const validationResLenBefore = generate.validationResults.length;
    const errorIndex = "Row" + (rowIndex + 1) + "Col" + (indexOfTag + 1);

    if (indexOfTag === -1) {
      return true;
    }

    switch (tag) {
      case "fullName":
        if (!regExpForSnakeCase.test(row[indexOfTag])) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationFullNameFormat"));
        }
        if (row[indexOfTag].substring(row[indexOfTag].length - 3, row[indexOfTag].length) !== "__c") {
          this.pushValidationResult(errorIndex, messages.getMessage("validationFullNameTail"));
        }
        if (row[indexOfTag].split("__").length > 2) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationFullNameUnderscore"));
        }
        if (row[indexOfTag].length === 0) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationFullNameBlank"));
        }
        if (row[indexOfTag].length > 43) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationFullNameLength"));
        }
        break;
      case "externalId":
        if ((type === "Number" || type === "Email" || type === "Text") && row[indexOfTag] !== "") {
          if (!generate.options.externalId.includes(row[indexOfTag].toLowerCase())) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationExternalIdOptions"));
          }
        }
        break;
      case "label":
        if (row[indexOfTag].length === 0) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationLabelBlank"));
        }
        if (row[indexOfTag].length > 40) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationLabelLength"));
        }
        break;
      case "description":
        if (row[indexOfTag].length > 1000) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationDescriptionLength"));
        }
        break;
      case "inlineHelpText":
        if (row[indexOfTag].length > 510) {
          this.pushValidationResult(errorIndex, messages.getMessage("validationIinlineHelpTextLength"));
        }
        break;
      case "required":
        if (!generate.options.required.includes(row[indexOfTag].toLowerCase()) && row[indexOfTag] !== "") {
          this.pushValidationResult(errorIndex, messages.getMessage("validationRequiredOptions"));
        }
        break;
      case "formula":
        if (
          (type === "Checkbox" ||
            type === "Currency" ||
            type === "Date" ||
            type === "DateTime" ||
            type === "Number" ||
            type === "Percent" ||
            type === "Text" ||
            type === "Time") &&
          row[indexOfTag] !== ""
        ) {
          if (row[indexOfTag].length > 3900) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationFormulaLength"));
          }
        }
        break;
      case "trackHistory":
        if (!generate.options.trackTrending.includes(row[indexOfTag].toLowerCase()) && row[indexOfTag] !== "") {
          this.pushValidationResult(errorIndex, messages.getMessage("validationTrackHistoryOptions"));
        }
        break;
      case "trackTrending":
        if (!generate.options.trackTrending.includes(row[indexOfTag].toLowerCase()) && row[indexOfTag] !== "") {
          this.pushValidationResult(errorIndex, messages.getMessage("validationTrackTrendingOptions"));
        }
        break;
      case "unique":
        if (!generate.options.unique.includes(row[indexOfTag].toLowerCase()) && row[indexOfTag] !== "") {
          this.pushValidationResult(errorIndex, messages.getMessage("validationUniqueOptions"));
        }
        break;
      case "defaultValue":
        if (type === "Checkbox" && row[indexOfTag] !== "") {
          if (!generate.options.defaultValue.includes(row[indexOfTag].toLowerCase())) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationDefaultValueOptions"));
          }
        }
        break;
      case "displayFormat":
        const invalidChars = ['"', "'", "&", "<", ">", ";", ":", "\\"];
        const regExpInvalidChars = new RegExp("[" + invalidChars.join("").replace("\\", "\\\\") + "]+");
        const regExpNumber = /{(0+)}/;
        const formatNumber = row[indexOfTag].match(regExpNumber);
        if (type === "AutoNumber" && row[indexOfTag] !== "") {
          if (regExpInvalidChars.test(row[indexOfTag])) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationDisplayFormatInvalidChar") + invalidChars.toString());
          }
          if (formatNumber === null) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationDisplayFormatFormat"));
          } else if (formatNumber[1].length > 10) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationDisplayFormatDigits"));
          }
          if (row[indexOfTag].length > 30) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationDisplayFormatLength"));
          }
        }
        break;
      case "displayLocationInDecimal":
        if (type === "Location" && row[indexOfTag] !== "") {
          if (!generate.options.displayLocationInDecimal.includes(row[indexOfTag].toLowerCase())) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationDisplayLocationInDecimalOptions"));
          }
        }
        break;
      case "scale":
        const indexOfPrecision = header.indexOf("precision");
        if ((type === "Number" || type === "Percent" || type === "Currency" || type === "Location") && row[indexOfTag] !== "") {
          if (!Number.isInteger(Number(row[indexOfTag]))) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationScaleType"));
          }
          if (Number(row[indexOfTag]) < 0) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationScaleNegative"));
          }
          if (Number(row[indexOfTag]) >= 8) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationScaleComarisonPrecision"));
          }
          if (indexOfPrecision === -1) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationNoPrecision"));
          } else {
            if (!Number.isInteger(Number(row[indexOfPrecision]))) {
              this.pushValidationResult(errorIndex, messages.getMessage("validationPrecisionType"));
            }
            if (Number(row[indexOfTag]) + Number(row[indexOfPrecision]) > 18) {
              this.pushValidationResult(errorIndex, messages.getMessage("validationScaleSum"));
            }
          }
        }
        break;
      case "precision":
        const indexOfScale = header.indexOf("scale");
        if ((type === "Number" || type === "Percent" || type === "Currency") && row[indexOfTag] !== "") {
          if (!Number.isInteger(Number(row[indexOfTag]))) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationPrecisionType"));
          }
          if (Number(row[indexOfTag]) < 0) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationPrecisionNegative"));
          }
          if (indexOfScale === -1) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationNoPrecision"));
          } else {
            if (!Number.isInteger(Number(row[indexOfScale]))) {
              this.pushValidationResult(errorIndex, messages.getMessage("validationScaleType"));
            }
            if (Number(row[indexOfScale]) + Number(row[indexOfTag]) > 18) {
              this.pushValidationResult(errorIndex, messages.getMessage("validationPrecisionSum"));
            }
            if (Number(row[indexOfScale]) >= 8) {
              this.pushValidationResult(errorIndex, messages.getMessage("validationPrecisionComarisonScale"));
            }
          }
        }
        break;
      case "visibleLines":
        if ((type === "MultiselectPicklist" || type === "LongTextArea" || type === "Html") && row[indexOfTag] !== "") {
          if (!Number.isInteger(Number(row[indexOfTag]))) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesType"));
          }
        }
        if (type === "LongTextArea" && row[indexOfTag] !== "") {
          if (Number(row[indexOfTag]) < 2) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesLongTextMin"));
          }
          if (Number(row[indexOfTag]) > 50) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesLongTextMax"));
          }
        }
        if (type === "Html" && row[indexOfTag] !== "") {
          if (Number(row[indexOfTag]) < 10) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesHtmlMin"));
          }
          if (Number(row[indexOfTag]) > 50) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesLongTextMax"));
          }
        }
        if (type === "MultiselectPicklist" && row[indexOfTag] !== "") {
          if (Number(row[indexOfTag]) < 3) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesPicklistMin"));
          }
          if (Number(row[indexOfTag]) > 10) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationVisibleLinesPicklistMax"));
          }
        }
        break;
      case "length":
        if (
          (type === "Text" || type === "LongTextArea" || type === "Html" || type === "EncryptedText" || type === "ExternalLookup") &&
          row[indexOfTag] !== ""
        ) {
          if (!Number.isInteger(Number(row[indexOfTag]))) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthType"));
          }
        }
        if ((type === "Text" || type === "ExternalLookup") && row[indexOfTag] !== "") {
          if (Number(row[indexOfTag]) < 1) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthTextMin"));
          }
          if (Number(row[indexOfTag]) > 255) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthTextMax"));
          }
        }
        if ((type === "LongTextArea" || type === "Html") && row[indexOfTag] !== "") {
          if (Number(row[indexOfTag]) < 256) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthLongTextMin"));
          }
          if (Number(row[indexOfTag]) > 131072) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthLongTextMax"));
          }
        }
        if (type === "EncryptedText" && row[indexOfTag] !== "") {
          if (Number(row[indexOfTag]) < 1) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthTextMin"));
          }
          if (Number(row[indexOfTag]) > 175) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationLengthEncryptedTextMax"));
          }
        }
        break;
      case "maskChar":
        if (type === "EncryptedText" && row[indexOfTag] !== "") {
          if (!generate.options.maskChar.includes(row[indexOfTag])) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationMaskCharOptions"));
          }
        }
        break;
      case "maskType":
        if (type === "EncryptedText" && row[indexOfTag] !== "") {
          if (!generate.options.maskType.includes(row[indexOfTag])) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationMaskTypeOptions") + generate.options.maskType.toString());
          }
        }
        break;
      case "caseSensitive":
        const indexOfUnique = header.indexOf("unique");
        if (type === "Text" && row[indexOfTag] !== "") {
          if (indexOfUnique === -1) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationNoUnique"));
          } else if (!generate.options.caseSensitive.includes(row[indexOfTag])) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationCaseSensitiveOptions"));
          }
        }
        break;
      case "formulaTreatBlanksAs":
        const indexOfFormula = header.indexOf("formula");
        if (
          (type === "Checkbox" ||
            type === "Currency" ||
            type === "Date" ||
            type === "DateTime" ||
            type === "Number" ||
            type === "Percent" ||
            type === "Text" ||
            type === "Time") &&
          row[indexOfTag] !== ""
        ) {
          if (indexOfFormula === -1) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationNoFormula"));
          } else if (!generate.options.formulaTreatBlanksAs.includes(row[indexOfTag])) {
            this.pushValidationResult(
              errorIndex,
              messages.getMessage("validationFormulaTreatBlanksAsOptions") + generate.options.formulaTreatBlanksAs.toString()
            );
          }
        }
        break;
      case "referenceTo":
        if ((type === "Lookup" || type === "MasterDetail" || type === "ExternalLookup") && row[indexOfTag] !== "") {
          const isCustomField = row[indexOfTag].substring(row[indexOfTag].length - 3, row[indexOfTag].length) == "__c";
          if (
            (row[indexOfTag].length > 1 && !regExpForSnakeCase.test(row[indexOfTag])) ||
            (row[indexOfTag].length == 1 && !regExpForOneChar.test(row[indexOfTag]))
          ) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationReferenceToFormat"));
          }
          if ((!isCustomField && row[indexOfTag].split("__").length > 1) || (isCustomField && row[indexOfTag].split("__").length > 2)) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationReferenceToUnderscore"));
          }
          if (row[indexOfTag].length === 0) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationReferenceToBlank"));
          }
          if ((!isCustomField && row[indexOfTag].length > 40) || (isCustomField && row[indexOfTag].length > 43)) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationReferenceToLength"));
          }
        }
        break;
      case "relationshipName":
        if ((type === "Lookup" || type === "MasterDetail" || type === "ExternalLookup") && row[indexOfTag] !== "") {
          const isCustomField = row[indexOfTag].substring(row[indexOfTag].length - 3, row[indexOfTag].length) == "__c";
          if (
            (row[indexOfTag].length > 1 && !regExpForSnakeCase.test(row[indexOfTag])) ||
            (row[indexOfTag].length == 1 && !regExpForOneChar.test(row[indexOfTag]))
          ) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationRelationshipNameFormat"));
          }
          if ((!isCustomField && row[indexOfTag].split("__").length > 1) || (isCustomField && row[indexOfTag].split("__").length > 2)) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationRelationshipNameUnderscore"));
          }
          if (row[indexOfTag].length === 0) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationRelationshipNameBlank"));
          }
          if (row[indexOfTag].length > 40) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationRelationshipNameLength"));
          }
        }
        break;
      case "relationshipLabel":
        if ((type === "Lookup" || type === "MasterDetail" || type === "ExternalLookup") && row[indexOfTag] !== "") {
          if (row[indexOfTag].length > 80) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationRelationshipLabelLength"));
          }
        }
        break;
      case "relationshipOrder":
        if (type === "MasterDetail" && row[indexOfTag] !== "") {
          if (!generate.options.relationshipOrder.includes(row[indexOfTag])) {
            this.pushValidationResult(
              errorIndex,
              messages.getMessage("validationRelationshipOrderOptions") + generate.options.relationshipOrder.toString()
            );
          }
        }
        break;
      case "deleteConstraint":
        if (type === "Lookup" && row[indexOfTag] !== "") {
          if (!generate.options.deleteConstraint.includes(row[indexOfTag])) {
            this.pushValidationResult(
              errorIndex,
              messages.getMessage("validationDeleteConstraintOptions") + generate.options.deleteConstraint.toString()
            );
          }
        }
        break;
      case "reparentableMasterDetail":
        if (type === "MasterDetail" && row[indexOfTag] !== "") {
          if (!generate.options.reparentableMasterDetail.includes(row[indexOfTag].toLowerCase())) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationReparentableMasterDetailOptions"));
          }
        }
        break;
      case "writeRequiresMasterRead":
        if (type === "MasterDetail" && row[indexOfTag] !== "") {
          if (!generate.options.writeRequiresMasterRead.includes(row[indexOfTag].toLowerCase())) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationWriteRequiresMasterReadOptions"));
          }
        }
        break;
      case "summarizedField":
        const indexOfSummaryOperation = header.indexOf("summaryOperation");
        if (type === "Summary" && indexOfSummaryOperation !== -1 && row[indexOfSummaryOperation] !== "") {
          const fullNameSplit = row[indexOfTag].split(".");
          if (
            row[indexOfTag] === "" &&
            row[indexOfSummaryOperation] !== "count" &&
            generate.options.summaryOperation.includes(row[indexOfSummaryOperation])
          ) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummarizedFieldNoSummaryOperation"));
          }
          if (fullNameSplit.length !== 2) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummarizedFieldInvalidReference"));
            break;
          }
          if (!regExpForSnakeCase.test(fullNameSplit[0]) || !regExpForSnakeCase.test(fullNameSplit[1])) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummarizedFieldFormat"));
          }
          if (fullNameSplit[0].split("__").length > 2 || fullNameSplit[1].split("__").length > 2) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummarizedFieldUnderscore"));
          }
          if (fullNameSplit[0].length === 0 || fullNameSplit[0].length === 0) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummarizedFieldBlank"));
          }
          if (!this.isValidLengthForSummary(fullNameSplit)) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummarizedFieldLength"));
          }
        }
        break;
      case "summaryForeignKey":
        if (type === "Summary") {
          const fullNameSplit = row[indexOfTag].split(".");
          if (fullNameSplit.length !== 2) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummaryForeignKeyInvalidReference"));
            break;
          }
          if (!regExpForSnakeCase.test(fullNameSplit[0]) || !regExpForSnakeCase.test(fullNameSplit[1])) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummaryForeignKeyFormat"));
          }
          if (fullNameSplit[0].split("__").length > 2 || fullNameSplit[1].split("__").length > 2) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummaryForeignKeyUnderscore"));
          }
          if (fullNameSplit[0].length === 0 || fullNameSplit[0].length === 0) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummaryForeignKeyBlank"));
          }
          if (!this.isValidLengthForSummary(fullNameSplit)) {
            this.pushValidationResult(errorIndex, messages.getMessage("validationSummaryForeignKeyLength"));
          }
        }
        break;
      case "summaryOperation":
        if (type === "Summary" && row[indexOfTag] !== "") {
          if (!generate.options.summaryOperation.includes(row[indexOfTag])) {
            this.pushValidationResult(
              errorIndex,
              messages.getMessage("validationSummaryOperationOptions") + generate.options.summaryOperation.toString()
            );
          }
        }
        break;
    }
    return validationResLenBefore == generate.validationResults.length;
  }

  private isValidInputsForPicklist(picklistFullNames: string[], picklistLabels: string[], header: string[], rowIndex: number) {
    const validationResLenBefore = generate.validationResults.length;
    const typeColIndex = header.indexOf("type");
    const picklistFullNamesColIndex = header.indexOf("picklistFullName");
    const picklistLabelsColIndex = header.indexOf("picklistLabel");
    const errorIndexForType = "Row" + (rowIndex + 1) + "Col" + (typeColIndex + 1);
    const errorIndexForFullName = "Row" + (rowIndex + 1) + "Col" + (picklistFullNamesColIndex + 1);
    const errorIndexForLabel = "Row" + (rowIndex + 1) + "Col" + (picklistLabelsColIndex + 1);
    // when picklist fullnames or labels are not found
    if (picklistFullNames === null) {
      this.pushValidationResult(errorIndexForType, messages.getMessage("validationNoPicklistFullName"));
    }
    if (picklistLabels === null) {
      this.pushValidationResult(errorIndexForType, messages.getMessage("validationNoPicklistLabel"));
    }

    if (picklistFullNames.length !== picklistLabels.length) {
      this.pushValidationResult(errorIndexForFullName, messages.getMessage("validationPicklistFullNameNumber"));
      this.pushValidationResult(errorIndexForLabel, messages.getMessage("validationPicklistLabelNumber"));
    }
    if (picklistFullNames.length > 1000) {
      this.pushValidationResult(errorIndexForFullName, messages.getMessage("validationPicklistFullNameLength"));
    }
    if (picklistLabels.length > 1000) {
      this.pushValidationResult(errorIndexForLabel, messages.getMessage("validationPicklistLabelLength"));
    }
    for (let idx = 0; idx < picklistFullNames.length; idx++) {
      if (picklistFullNames[idx].length === 0) {
        this.pushValidationResult(errorIndexForFullName, messages.getMessage("validationPicklistFullNameBlank"));
      }
      if (picklistLabels[idx].length === 0) {
        this.pushValidationResult(errorIndexForLabel, messages.getMessage("validationPicklistLabelBlank"));
      }
      if (picklistFullNames[idx].length > 255) {
        this.pushValidationResult(errorIndexForFullName, messages.getMessage("validationPicklistFullNameMax"));
      }
      if (picklistLabels[idx].length > 255) {
        this.pushValidationResult(errorIndexForLabel, messages.getMessage("validationPicklistLabelMax"));
      }
    }
    return validationResLenBefore == generate.validationResults.length;
  }

  private isValidInputsForSummaryFilterItems(field: string, operation: string, value: string, header: string[], rowIndex: number): boolean {
    const validationResLenBefore = generate.validationResults.length;
    const fieldColIndex = header.indexOf("summaryFilterItemsField");
    const operationColIndex = header.indexOf("summaryFilterItemsOperation");
    const valueColIndex = header.indexOf("summaryFilterItemsValue");
    const errorIndexForField = "Row" + (rowIndex + 1) + "Col" + (fieldColIndex + 1);
    const errorIndexForOperation = "Row" + (rowIndex + 1) + "Col" + (operationColIndex + 1);
    const errorIndexForValue = "Row" + (rowIndex + 1) + "Col" + (valueColIndex + 1);

    // when tags of summaryFilterItems are not found
    if (field === null) {
      this.pushValidationResult(errorIndexForField, messages.getMessage("validationNoSummaryFilterItemsField"));
    }
    if (operation === null) {
      this.pushValidationResult(errorIndexForOperation, messages.getMessage("validationNoSummaryFilterItemsOperation"));
    }
    if (value === null) {
      this.pushValidationResult(errorIndexForValue, messages.getMessage("validationNoSummaryFilterItemsValue"));
    }

    // for field tag
    const isCustomField = field.substring(field.length - 3, field.length) == "__c";
    const regExpForOneChar = /^[a-zA-Z]/;
    const regExpForSnakeCase = /^[a-zA-Z][0-9a-zA-Z_]+[a-zA-Z]$/;
    if ((field.length > 1 && !regExpForSnakeCase.test(field)) || (field.length == 1 && !regExpForOneChar.test(field))) {
      this.pushValidationResult(errorIndexForField, messages.getMessage("validationSummaryFilterItemsFieldFormat"));
    }
    if ((!isCustomField && field.split("__").length > 1) || (isCustomField && field.split("__").length > 2)) {
      this.pushValidationResult(errorIndexForField, messages.getMessage("validationSummaryFilterItemsFieldUnderscore"));
    }
    if (field.length === 0) {
      this.pushValidationResult(errorIndexForField, messages.getMessage("validationSummaryFilterItemsFieldBlank"));
    }
    if ((!isCustomField && field.length > 40) || (isCustomField && field.length > 43)) {
      this.pushValidationResult(errorIndexForField, messages.getMessage("validationSummaryFilterItemsFieldLength"));
    }
    //for operation tag
    if (!generate.options.summaryFilterItemsOperation.includes(operation)) {
      this.pushValidationResult(
        errorIndexForOperation,
        messages.getMessage("validationSummaryFilterItemsOperationOptions") + generate.options.summaryFilterItemsOperation.toString()
      );
    }
    //for value tag
    if (value.length > 255) {
      this.pushValidationResult(errorIndexForValue, messages.getMessage("validationSummaryFilterItemsValueLength"));
    }

    return validationResLenBefore == generate.validationResults.length;
  }

  private pushValidationResult(index: string, errorMessage: string) {
    generate.validationResults.push({ INDEX: index, PROBLEM: errorMessage });
  }

  private convertSpecialChars(str: string): string {
    str = str.replace(/""/g, '"');
    str = str.replace(/&/g, "&" + "amp;");
    str = str.replace(/</g, "&" + "lt;");
    str = str.replace(/>/g, "&" + "gt;");
    str = str.replace(/"/g, "&" + "quot;");
    str = str.replace(/'/g, "&" + "#x27;");
    str = str.replace(/`/g, "&" + "#x60;");
    return str;
  }

  private formatBoolean(tag: string, row: string[], indexOfTag: number) {
    if (generate.options[tag] !== undefined) {
      if (generate.options[tag].includes(true.toString()) && generate.options[tag].includes(false.toString())) {
        row[indexOfTag] = row[indexOfTag].toLowerCase();
      }
    }
  }

  private isValidLengthForSummary(fullNames: string[]): boolean {
    let isValidLength = true;
    for (const fullName of fullNames) {
      const isCustomField = fullName.substring(fullName.length - 3, fullName.length) == "__c";
      if (isCustomField) {
        isValidLength = fullName.length <= 43 && isValidLength;
      } else {
        isValidLength = fullName.length <= 40 && isValidLength;
      }
    }
    return isValidLength;
  }

  private showValidationErrorMessages() {
    const logLengths = this.getLogLenghts(generate.validationResults);
    this.showLogHeader(logLengths);
    this.showLogBody(generate.validationResults, logLengths);
    throw new SfError(messages.getMessage("validation"));
  }

  private saveMetaData() {
    const logLengths = this.getLogLenghts(generate.successResults);
    const blue = "\u001b[34m";
    const white = "\u001b[37m";
    console.log("===" + blue + " Generated Source" + white);
    this.showLogHeader(logLengths);
    for (const meta of generate.metaInfo) {
      if (!existsSync(join(this.flags.outputdir, meta.fullName + "." + generate.fieldExtension))) {
        // for creating
        writeFileSync(join(this.flags.outputdir, meta.fullName + "." + generate.fieldExtension), meta.metaStr, "utf8");
      } else if (this.flags.updates) {
        // for updating
        this.updateFile(meta);
      } else {
        // when fail to save
        generate.failureResults[meta.fullName + "." + generate.fieldExtension] =
          "Failed to save " + meta.fullName + "." + generate.fieldExtension + ". " + messages.getMessage("failureSave");
      }
    }
    this.showLogBody(generate.successResults, logLengths);
  }

  private updateFile(meta: any) {
    let metastrToUpdate = readFileSync(join(this.flags.outputdir, meta.fullName + "." + generate.fieldExtension), "utf8");
    for (const tag of generate.tagNames) {
      if (tag !== "picklistFullName" && tag !== "picklistLabel") {
        const regexp = new RegExp("\\<" + tag + "\\>(.+)\\</" + tag + "\\>");
        const newValue = meta.metaStr.match(regexp);
        if (newValue !== null) {
          metastrToUpdate = metastrToUpdate.replace(regexp, newValue[0]);
        }
      } else {
        const regexp = new RegExp("\\<valueSet\\>[\\s\\S]*\\</valueSet\\>");
        const newValue = meta.metaStr.match(regexp);
        if (newValue !== null) {
          metastrToUpdate = metastrToUpdate.replace(regexp, newValue[0]);
        }
      }
    }
    writeFileSync(join(this.flags.outputdir, meta.fullName + "." + generate.fieldExtension), metastrToUpdate, "utf8");
  }

  private getLogLenghts(logs: any[]) {
    let logLengths = {};
    for (const log of logs) {
      for (const logName in log) {
        if (logLengths[logName] < log[logName].length || logLengths[logName] === undefined) {
          logLengths[logName] = log[logName].length;
        }
      }
    }
    return logLengths;
  }

  private showLogHeader(logLengths: any) {
    let header = "";
    let line = "";
    const whiteSpace = " ";
    const lineChar = "─";

    let counter = 0;
    for (const logName in logLengths) {
      counter++;
      header += logName;
      if (counter < Object.keys(logLengths).length) {
        header += whiteSpace.repeat(logLengths[logName] - logName.length) + "\t";
      }
      line += lineChar.repeat(logLengths[logName]) + "\t";
    }
    console.log(header);
    console.log(line);
  }

  private showLogBody(logs: any[], logLengths: any) {
    const whiteSpace = " ";
    for (const log of logs) {
      if (generate.failureResults[log.FULLNAME]) {
        continue;
      }
      let logMessage = "";
      let counter = 0;
      for (const logName in log) {
        counter++;
        logMessage += log[logName];
        if (counter < Object.keys(log).length) {
          logMessage += whiteSpace.repeat(logLengths[logName] - log[logName].length) + "\t";
        }
      }
      console.log(logMessage);
    }
  }

  private showFailureResults() {
    if (Object.keys(generate.failureResults).length === 0) {
      return;
    }
    const red = "\u001b[31m";
    const white = "\u001b[37m";
    console.log("\n===" + red + " Failure" + white);
    for (const fullName in generate.failureResults) {
      console.log(generate.failureResults[fullName]);
    }
  }

  private getIndentation(length: number): string {
    const whiteSpace = " ";
    return whiteSpace.repeat(length);
  }
}
