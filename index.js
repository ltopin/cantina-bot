import express from 'express';
import multer from 'multer';
import axios from 'axios';
import fs, { createWriteStream } from 'fs';
import { google } from 'googleapis';
import { pipeline } from 'stream';
import { promisify } from 'util';
import FormData from 'form-data';

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

app.use(express.json());
const streamPipeline = promisify(pipeline);

app.post('/webhook/audio', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.type !== 'audio' || !message.url) {
      return res.status(400).send('Não é um áudio válido');
    }

    const audioUrl = message.url;
    const audioPath = `uploads/audio-${Date.now()}.ogg`;

    const audioStream = await axios.get(audioUrl, { responseType: 'stream' });
    await streamPipeline(audioStream.data, createWriteStream(audioPath));

    // Transcrição com Whisper
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
    console.log('Texto transcrito:', texto);

    const match = texto.match(/(\w+)\scomprou\s(uma|um)\s([\w\s]+)\spor\s([\w\s]+)\s?/i);
    if (!match) return res.send('Não foi possível extrair os dados');

    const [nome, produto, valor] = match;

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDS),
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
    fs.unlink(audioPath, () => {});
  } catch (err) {
    console.error('Erro ao processar áudio:', err);
    res.status(500).send('Erro ao processar o áudio');
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
