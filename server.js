const express = require('express');
const multer = require('multer');
const qr = require('qrcode');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const AdmZip = require('adm-zip');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;
const IP_ADDRESS = '192.168.0.103';

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

const secretKey = crypto.randomBytes(32).toString('hex');

app.use(session({
    secret: secretKey,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.post('/upload', upload.array('files'), (req, res) => {
    const files = req.files.map(file => file.path);
    const link = `http://${IP_ADDRESS}:${PORT}/download?files=${files.join(',')}`;

    req.session.link = link;
    req.session.expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    qr.toDataURL(link, (err, qrCode) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        }
        res.render('sharablelink', { qrCode, link });
    });
});

app.get('/download', (req, res) => {
    const files = req.query.files.split(',');
    if (!files || files.length === 0) {
        return res.status(400).send('No files specified for download.');
    }

    const zipFilePath = `downloads/${Date.now()}.zip`;
    zipFiles(files, zipFilePath, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error zipping files.');
        }

        res.download(zipFilePath, 'shared_files.zip', (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error sending zip file.');
            }

            fs.unlink(zipFilePath, (err) => {
                if (err) {
                    console.error(err);
                }
            });
        });
    });
});

function zipFiles(files, zipFilePath, callback) {
    const zip = new AdmZip();
    files.forEach(file => {
        zip.addLocalFile(file);
    });
    zip.writeZip(zipFilePath, callback);
}

const job = schedule.scheduleJob('0 * * * *', () => {
    cleanupExpiredFiles();
});

function cleanupExpiredFiles() {
    console.log('Running cleanupExpiredFiles function...');

    const uploadsFolder = 'uploads/';
    const now = Date.now();

    try {
        const files = fs.readdirSync(uploadsFolder);

        files.forEach(file => {
            const filePath = path.join(uploadsFolder, file);
            const stats = fs.statSync(filePath);

            const fileAge = now - stats.mtime.getTime();
            const oneDayInMillis = 24 * 60 * 60 * 1000;

            if (fileAge > oneDayInMillis) {
                fs.unlinkSync(filePath);
                console.log(`Deleted expired file: ${filePath}`);
            } else {
                console.log(`File not yet expired: ${filePath}`);
            }
        });
    } catch (err) {
        console.error('Error cleaning up files:', err);
    }
}

app.listen(PORT, IP_ADDRESS, () => {
    console.log(`Server is running on http://${IP_ADDRESS}:${PORT}`);
    console.log(`Secret Key for Session Management: ${secretKey}`);
});