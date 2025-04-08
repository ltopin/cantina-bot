import express from 'express';
import multer from 'multer';
import axios from 'axios';
import fs from 'fs';
import { google } from 'googleapis';
import path from 'path';

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/webhook/audio', upload.single('audio'), async (req, res) => {
  const audioPath = req.file.path;

  // Transcrição com Whisper API
  const formData = new FormData();
  formData.append('file', fs.createReadStream(audioPath));
  formData.append('model', 'whisper-1');

  const transcriptRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      ...formData.getHeaders()
    }
  });

  const texto = transcriptRes.data.text;
  const match = texto.match(/(\w+) comprou (uma|um) ([\w\s]+) por ([\w\s]+)\.?/i);
  if (!match) return res.send('Não foi possível extrair os dados');

  const [, nome, , produto, valor] = match;

  // Autenticação com Google Sheets
  const auth = new google.auth.GoogleAuth({
    keyFile: 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SHEET_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[nome, produto, valor, new Date().toISOString()]]
    }
  });

  res.send('Venda registrada com sucesso');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
