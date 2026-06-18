import { Router } from 'express';
import { getShipmentOrders } from '../services/tuttiShipmentService.js';

const router = Router();

router.get('/orders', async (req, res) => {
  try {
    const rows = await getShipmentOrders({
      lot_no: String(req.query.lot_no || '').trim(),
      panel: String(req.query.panel || '').trim(),
      date_from: String(req.query.date_from || '').trim(),
      date_to: String(req.query.date_to || '').trim(),
      only_shippable: req.query.only_shippable === '1' || req.query.only_shippable === 'true',
    });

    res.json({ success: true, rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, rows: [] });
  }
});

export default router;
