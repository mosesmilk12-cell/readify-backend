const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const CloudConvert = require("cloudconvert");

const router = express.Router();

const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

router.post("/convert-doc-to-pdf", upload.single("file"), async (req, res) => {
  let uploadedPath = null;

  try {
    if (!process.env.CLOUDCONVERT_API_KEY) {
      return res.status(500).json({
        error: "CloudConvert API key is not configured."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded."
      });
    }

    uploadedPath = req.file.path;

    const originalName = req.file.originalname || "document.docx";
    const ext = path.extname(originalName).replace(".", "").toLowerCase();

    if (!["doc", "docx", "pptx", "txt", "html"].includes(ext)) {
      return res.status(400).json({
        error: "Unsupported file type. Only DOC, DOCX, PPTX, TXT, and HTML are allowed."
      });
    }

    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": {
          operation: "import/upload"
        },
        "convert-file": {
          operation: "convert",
          input: "import-file",
          output_format: "pdf"
        },
        "export-file": {
          operation: "export/url",
          input: "convert-file"
        }
      }
    });

    const uploadTask = job.tasks.find(task => task.name === "import-file");

    if (!uploadTask) {
      throw new Error("CloudConvert upload task was not created.");
    }

    await cloudConvert.tasks.upload(
      uploadTask,
      fs.createReadStream(uploadedPath),
      originalName
    );

    const completedJob = await cloudConvert.jobs.wait(job.id);

    const exportTask = completedJob.tasks.find(
      task => task.name === "export-file" && task.status === "finished"
    );

    if (!exportTask || !exportTask.result || !exportTask.result.files || !exportTask.result.files[0]) {
      throw new Error("Converted PDF export URL was not returned.");
    }

    const file = exportTask.result.files[0];

    return res.json({
      success: true,
      filename: file.filename,
      pdfUrl: file.url
    });

  } catch (error) {
    console.error("DOC to PDF conversion failed:", error);
    return res.status(500).json({
      error: "Document conversion failed."
    });
  } finally {
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      fs.unlinkSync(uploadedPath);
    }
  }
});

module.exports = router;