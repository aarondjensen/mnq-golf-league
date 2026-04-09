export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ics, filename } = req.body;
    if (!ics) return res.status(400).json({ error: 'Missing ics data' });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'schedule.ics'}"`);
    res.status(200).send(ics);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate calendar file' });
  }
}
