const pdf2pic = require('pdf2pic');
const fs = require('fs-extra');
const path = require('path');

/**
 * PDF to JPG Conversion Utilities
 * Provides functions to convert PDF files to JPG images
 */

/**
 * Default conversion options
 */
const DEFAULT_OPTIONS = {
  density: 100,           // Output resolution in DPI
  saveFilename: "page",   // Base filename for output images
  savePath: "./output",   // Output directory
  format: "jpg",          // Output format
  width: 600,             // Output width in pixels
  height: 800,            // Output height in pixels
  quality: 75             // JPG quality (1-100)
};

/**
 * Convert a single page of PDF to JPG
 * @param {string} pdfPath - Path to the PDF file
 * @param {number} pageNumber - Page number to convert (1-based)
 * @param {Object} options - Conversion options
 * @returns {Promise<string>} - Path to the generated JPG file
 */
async function convertPdfPageToJpg(pdfPath, pageNumber = 1, options = {}) {
  try {
    // Validate input
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    
    // Ensure output directory exists
    await fs.ensureDir(mergedOptions.savePath);

    // Configure pdf2pic
    const convert = pdf2pic.fromPath(pdfPath, {
      density: mergedOptions.density,
      saveFilename: `${mergedOptions.saveFilename}_${pageNumber}`,
      savePath: mergedOptions.savePath,
      format: mergedOptions.format,
      width: mergedOptions.width,
      height: mergedOptions.height,
      quality: mergedOptions.quality
    });

    // Convert specific page
    const result = await convert(pageNumber);
    
    if (!result || !result.path) {
      throw new Error(`Failed to convert page ${pageNumber} of PDF`);
    }

    console.log(`Successfully converted page ${pageNumber} to: ${result.path}`);
    return result.path;

  } catch (error) {
    console.error(`Error converting PDF page to JPG: ${error.message}`);
    throw error;
  }
}

/**
 * Convert all pages of PDF to JPG images
 * @param {string} pdfPath - Path to the PDF file
 * @param {Object} options - Conversion options
 * @returns {Promise<string[]>} - Array of paths to generated JPG files
 */
async function convertPdfToJpgs(pdfPath, options = {}) {
  try {
    // Validate input
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    
    // Ensure output directory exists
    await fs.ensureDir(mergedOptions.savePath);

    // Configure pdf2pic for bulk conversion
    const convert = pdf2pic.fromPath(pdfPath, {
      density: mergedOptions.density,
      saveFilename: mergedOptions.saveFilename,
      savePath: mergedOptions.savePath,
      format: mergedOptions.format,
      width: mergedOptions.width,
      height: mergedOptions.height,
      quality: mergedOptions.quality
    });

    // Convert all pages (bulk conversion)
    const results = await convert.bulk(-1);
    
    if (!results || results.length === 0) {
      throw new Error('Failed to convert PDF to images');
    }

    const imagePaths = results.map(result => result.path);
    console.log(`Successfully converted ${imagePaths.length} pages to JPG images`);
    
    return imagePaths;

  } catch (error) {
    console.error(`Error converting PDF to JPGs: ${error.message}`);
    throw error;
  }
}

/**
 * Convert PDF to a single merged JPG image (first page only)
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} outputPath - Path for the output JPG file
 * @param {Object} options - Conversion options
 * @returns {Promise<string>} - Path to the generated JPG file
 */
async function convertPdfToSingleJpg(pdfPath, outputPath, options = {}) {
  try {
    const tempDir = path.join(path.dirname(outputPath), 'temp_pdf_conversion');
    const tempOptions = {
      ...options,
      savePath: tempDir,
      saveFilename: 'temp_page'
    };

    // Convert first page to temporary location
    const tempImagePath = await convertPdfPageToJpg(pdfPath, 1, tempOptions);
    
    // Move to final location
    await fs.ensureDir(path.dirname(outputPath));
    await fs.move(tempImagePath, outputPath, { overwrite: true });
    
    // Clean up temp directory
    await fs.remove(tempDir);
    
    console.log(`Successfully converted PDF to single JPG: ${outputPath}`);
    return outputPath;

  } catch (error) {
    console.error(`Error converting PDF to single JPG: ${error.message}`);
    throw error;
  }
}

/**
 * Get information about a PDF file
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<Object>} - PDF information
 */
async function getPdfInfo(pdfPath) {
  try {
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      throw new Error(`PDF file not found: ${pdfPath}`);
    }

    const stats = await fs.stat(pdfPath);
    
    return {
      path: pdfPath,
      size: stats.size,
      modified: stats.mtime,
      exists: true
    };

  } catch (error) {
    console.error(`Error getting PDF info: ${error.message}`);
    throw error;
  }
}

/**
 * Clean up generated image files
 * @param {string} directoryPath - Directory containing images to clean up
 * @param {string} pattern - File pattern to match (default: *.jpg)
 * @returns {Promise<void>}
 */
async function cleanupImages(directoryPath, pattern = '*.jpg') {
  try {
    if (!await fs.pathExists(directoryPath)) {
      console.log(`Directory does not exist: ${directoryPath}`);
      return;
    }

    const files = await fs.readdir(directoryPath);
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ext === '.jpg' || ext === '.jpeg' || ext === '.png';
    });

    for (const file of imageFiles) {
      const filePath = path.join(directoryPath, file);
      await fs.remove(filePath);
      console.log(`Deleted: ${filePath}`);
    }

    console.log(`Cleaned up ${imageFiles.length} image files from ${directoryPath}`);

  } catch (error) {
    console.error(`Error cleaning up images: ${error.message}`);
    throw error;
  }
}

module.exports = {
  convertPdfPageToJpg,
  convertPdfToJpgs,
  convertPdfToSingleJpg,
  getPdfInfo,
  cleanupImages,
  DEFAULT_OPTIONS
};



