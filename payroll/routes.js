const express = require('express');
const router = express.Router();
const { startPeriod, getPreview, updateEmployeeItem, closePeriod } = require('./service');

function assertEnabled(req, res, next) {
  if (process.env.PAYROLL_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Payroll disabled' });
  }
  next();
}

router.post('/start', assertEnabled, async (req, res) => {
  try {
    const { uid } = req.user || {};
    const period = await startPeriod({ createdBy: uid });
    res.status(201).json(period);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to start period' });
  }
});

router.get('/:periodId/preview', assertEnabled, async (req, res) => {
  try {
    const data = await getPreview(req.params.periodId);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load preview' });
  }
});

router.patch('/:periodId/employee/:employeeId', assertEnabled, async (req, res) => {
  try {
    const updated = await updateEmployeeItem(req.params.periodId, req.params.employeeId, req.body);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update employee item' });
  }
});

router.post('/:periodId/close', assertEnabled, async (req, res) => {
  try {
    const fileInfo = await closePeriod(req.params.periodId);
    res.json(fileInfo);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to close period' });
  }
});

module.exports = router;
