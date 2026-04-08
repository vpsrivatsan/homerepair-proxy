import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 }); // 20MB max

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "File upload failed: " + err.message });
    const file = files.pdf?.[0];
    if (!file) return res.status(400).json({ error: "No PDF file provided" });

    try {
      const buffer = fs.readFileSync(file.filepath);
      const data = await pdfParse(buffer);
      if (!data.text?.trim()) throw new Error("No selectable text found in PDF");
      res.status(200).json({ text: data.text, pages: data.numpages });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      // Clean up temp file
      fs.unlink(file.filepath, () => {});
    }
  });
}
