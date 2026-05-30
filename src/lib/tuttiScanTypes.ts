/**
 * Shared types for the Tutti mobile scan workflow.
 *
 * These types define the data structures exchanged between
 * the work-order QR parser, the disk QR parser (parseQbiQr),
 * and the scan verifier.
 */

/** Parsed result from a work-order QR code. */
export type ParsedWorkOrderQr = {
  ok: boolean;
  errors: string[];
  workOrderNumber: string;
  lotNo: string;
  finishedBatchNo: string;
};

/** A work-order record as stored in RDS beadsdb.production.tutti_work_orders. */
export type TuttiWorkOrder = {
  workOrderNumber: string;
  lotNo: string;
  finishedBatchNo: string;
  markerNames: string[];
};

/** Result of the full Tutti scan verification. */
export type TuttiScanVerification = {
  ok: boolean;
  errors: string[];
  /** Markers on the disk that passed verification. */
  matchedMarkers: string[];
  /** Markers on the disk that are not in the work-order. */
  unknownMarkers: string[];
};

/** Payload to be written to RDS tutti_scan_records. */
export type TuttiScanRecord = {
  workOrderNumber: string;
  lotNo: string;
  finishedBatchNo: string;
  diskLotNo: string;
  panelName: string;
  markerNames: string[];
  scannedAt: string;
  tuttiPosition: string;
  machineQr: string;
};
