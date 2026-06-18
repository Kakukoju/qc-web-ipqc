import { strict as assert } from 'assert';
import {
  extractQtyFromFormData,
  extractExpDateFromFormData,
  extractPanelFromFormData,
  isShipmentLot,
  lotNoMatchesLotCodeSuffix,
  mfgLotNoToLotCodes,
  mfgLotNoToLotCodePatterns,
  lotCodeMatchesLotNo,
  normalizeLotCode,
  parseFormData,
} from '../services/tuttiShipmentService.js';
import { pool } from '../db/pgPool.js';

async function run() {
  assert.deepEqual(parseFormData('{"qty":"10"}'), { qty: '10' });
  assert.deepEqual(parseFormData('{bad'), {});

  assert.equal(extractQtyFromFormData({ qty: '1,200' }), 1200);
  assert.equal(extractQtyFromFormData({ wells: { L1: { qty1: '1000', qty2: '500' }, L2: { qty1: '250' } } }), 1750);
  assert.equal(extractQtyFromFormData({ header: { productionOrderQty: '1000' } }), 1000);
  assert.equal(extractPanelFromFormData({ header: { formTitle: '(DB) 糖尿病 Diabetes  10 Panel\n製程紀錄表' } }), 'Diabetes 10 Panel');
  assert.equal(extractExpDateFromFormData({ postProcess: [{ productExpiry: '2027-06-10' }] }), '2027-06-10');

  assert.equal(isShipmentLot('1-053054-26060249'), true);
  assert.equal(isShipmentLot('1-053054-26060250'), false);

  assert.deepEqual(mfgLotNoToLotCodes('1-053054-26060201', ['1', '2']), [
    '1053_26060201',
    '1054_26060201',
    '2053_26060201',
    '2054_26060201',
  ]);
  assert.deepEqual(mfgLotNoToLotCodes('1-000053-26060201', ['3']), ['3053_26060201']);
  assert.equal(normalizeLotCode('1053_26060201'), '053_26060201');
  assert.equal(normalizeLotCode('105326060201'), '053_26060201');
  assert.equal(lotNoMatchesLotCodeSuffix('1-053054-26060201', '1053_26060201'), true);
  assert.equal(lotNoMatchesLotCodeSuffix('1-053054-26060201', '1053_26060250'), false);

  // ─── New: mfgLotNoToLotCodePatterns tests ───
  // 2片/盒: "1-051052-26060902" → sub_panels 051, 052; 生產日 260609
  assert.deepEqual(mfgLotNoToLotCodePatterns('1-051052-26060902'), [
    { subPanelType: '051', productionDate: '260609' },
    { subPanelType: '052', productionDate: '260609' },
  ]);
  // 1片/盒: "1-000053-26060201" → sub_panel 053; 生產日 260602
  assert.deepEqual(mfgLotNoToLotCodePatterns('1-000053-26060201'), [
    { subPanelType: '053', productionDate: '260602' },
  ]);
  // Invalid format
  assert.deepEqual(mfgLotNoToLotCodePatterns('bad'), []);

  // ─── New: lotCodeMatchesLotNo tests ───
  // lot_no = "1-051052-26060902", lot_code = "105126060901" (line=1, sub=051, date=260609, batch=01)
  assert.equal(lotCodeMatchesLotNo('105126060901', '1-051052-26060902'), true);
  // lot_code with different line (line=2) but same sub + date → still matches
  assert.equal(lotCodeMatchesLotNo('205126060901', '1-051052-26060902'), true);
  // Second sub_panel (052) matches too
  assert.equal(lotCodeMatchesLotNo('105226060915', '1-051052-26060902'), true);
  // Different batch suffix (YZ=49) still matches (not comparing YZ for now)
  assert.equal(lotCodeMatchesLotNo('105126060949', '1-051052-26060902'), true);
  // Different production date → does NOT match
  assert.equal(lotCodeMatchesLotNo('105126061001', '1-051052-26060902'), false);
  // Different sub_panel_type → does NOT match
  assert.equal(lotCodeMatchesLotNo('109926060901', '1-051052-26060902'), false);
  // Underscore format
  assert.equal(lotCodeMatchesLotNo('1051_26060901', '1-051052-26060902'), true);

  console.log('tuttiShipmentService tests passed');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
