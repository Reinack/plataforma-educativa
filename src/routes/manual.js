const express = require('express');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res) => {
  res.render('manual/index', { title: 'Manual de uso', rol: req.session.user.rol });
});

module.exports = router;
