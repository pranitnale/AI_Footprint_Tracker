import { isDisplayBinding, type DisplayBinding } from "@footprint/capture-core";
import {
  fileKeys,
  validUploadAssociation,
  type UploadAssociationMessage,
} from "./file-relay-protocol";
export type FileCaptureAssociation = {
  target: "file-capture-association";
  binding: DisplayBinding;
  association: UploadAssociationMessage;
};
export type FileCaptureAssociationReply = { accepted: boolean };
export function validFileCaptureAssociation(
  value: unknown,
): value is FileCaptureAssociation {
  return (
    fileKeys(value, ["target", "binding", "association"]) &&
    value.target === "file-capture-association" &&
    validUploadAssociation(value.association) &&
    isDisplayBinding(value.binding, value.association.captureId)
  );
}
