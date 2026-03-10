/**
 * Register all Agenda job definitions.
 * Must be called once before agenda.start().
 */
import { registerGenerateIrnJob } from './definitions/generate-irn.job';
import { registerTransformJob } from './definitions/transform.job';
import { registerValidateJob } from './definitions/validate.job';
import { registerSignJob } from './definitions/sign.job';
import { registerTransmitJob } from './definitions/transmit.job';
import { registerCompleteOutboundJob } from './definitions/complete-outbound.job';
import { registerCompleteInboundJob } from './definitions/complete-inbound.job';
import { registerReportVatJob } from './definitions/report-vat.job';
import { registerConfirmStatusJob } from './definitions/confirm-status.job';

export function registerAllJobs(): void {
  registerGenerateIrnJob();
  registerTransformJob();
  registerValidateJob();
  registerSignJob();
  registerTransmitJob();
  registerCompleteOutboundJob();
  registerCompleteInboundJob();
  registerReportVatJob();
  registerConfirmStatusJob();
}
