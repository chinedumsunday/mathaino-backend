const router = require('express').Router();
const { myCertificates } = require('../controllers/certificateController');
const authenticate = require('../middleware/authenticate');

router.use(authenticate);

router.get('/', myCertificates);

module.exports = router;
