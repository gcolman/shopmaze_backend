#!/usr/bin/env node

/**
 * Test script to fetch invoice_1016, extract the PDF, and verify it's not corrupted
 */

const fs = require('fs').promises;
const path = require('path');

async function testInvoice1016() {
    console.log('🧪 Testing invoice_1016 extraction and PDF validation...\n');
    
    try {
        // 1. Read the invoice JSON file
        const invoicePath = path.join(__dirname, 'src', 'invoices', 'invoice_1016.json');
        console.log(`📄 Reading invoice file: ${invoicePath}`);
        
        const invoiceData = await fs.readFile(invoicePath, 'utf8');
        const invoice = JSON.parse(invoiceData);
        
        console.log(`✅ Invoice loaded successfully`);
        console.log(`   Invoice Number: ${invoice.invoiceNumber}`);
        console.log(`   Filename: ${invoice.filename}`);
        console.log(`   File Size: ${invoice.fileSize} bytes`);
        console.log(`   Processed At: ${invoice.processedAt}`);
        console.log(`   Base64 Length: ${invoice.base64Data.length} characters`);
        
        // 2. Extract and decode the PDF
        console.log('\n📋 Extracting PDF from base64...');
        const pdfBuffer = Buffer.from(invoice.base64Data, 'base64');
        console.log(`✅ PDF extracted successfully`);
        console.log(`   Decoded PDF size: ${pdfBuffer.length} bytes`);
        console.log(`   Expected size: ${invoice.fileSize} bytes`);
        
        // 3. Verify size matches
        if (pdfBuffer.length === invoice.fileSize) {
            console.log(`✅ Size verification passed`);
        } else {
            console.log(`❌ Size mismatch! Expected: ${invoice.fileSize}, Got: ${pdfBuffer.length}`);
            return false;
        }
        
        // 4. Check PDF header (PDF files start with %PDF)
        console.log('\n🔍 Validating PDF header...');
        const pdfHeader = pdfBuffer.toString('ascii', 0, 4);
        console.log(`   PDF Header: "${pdfHeader}"`);
        
        if (pdfHeader === '%PDF') {
            console.log(`✅ Valid PDF header found`);
        } else {
            console.log(`❌ Invalid PDF header! Expected "%PDF", got "${pdfHeader}"`);
            return false;
        }
        
        // 5. Check for PDF structure markers
        console.log('\n🔍 Checking PDF structure...');
        const pdfContent = pdfBuffer.toString('ascii');
        
        const hasPDFVersion = pdfContent.includes('PDF-');
        const hasEndOfFile = pdfContent.includes('%%EOF');
        const hasXref = pdfContent.includes('xref');
        const hasTrailer = pdfContent.includes('trailer');
        
        console.log(`   PDF Version marker: ${hasPDFVersion ? '✅' : '❌'}`);
        console.log(`   End of file marker: ${hasEndOfFile ? '✅' : '❌'}`);
        console.log(`   Cross-reference table: ${hasXref ? '✅' : '❌'}`);
        console.log(`   Trailer: ${hasTrailer ? '✅' : '❌'}`);
        
        if (hasPDFVersion && hasEndOfFile && hasXref && hasTrailer) {
            console.log(`✅ PDF structure appears valid`);
        } else {
            console.log(`❌ PDF structure validation failed`);
            return false;
        }
        
        // 6. Save extracted PDF for manual inspection
        const outputPath = path.join(__dirname, 'extracted_invoice_1016.pdf');
        console.log(`\n💾 Saving extracted PDF to: ${outputPath}`);
        await fs.writeFile(outputPath, pdfBuffer);
        console.log(`✅ PDF saved successfully`);
        
        // 7. Additional validation - check for common PDF corruption patterns
        console.log('\n🔍 Checking for corruption patterns...');
        
        // Check for null bytes in critical areas (can indicate corruption)
        const hasNullBytes = pdfBuffer.includes(0x00);
        console.log(`   Null bytes present: ${hasNullBytes ? '⚠️  Warning' : '✅ None'}`);
        
        // Check for reasonable content length
        const contentLength = pdfContent.length;
        const expectedMinLength = 100; // Minimum reasonable PDF size
        const hasReasonableLength = contentLength > expectedMinLength;
        console.log(`   Content length reasonable: ${hasReasonableLength ? '✅' : '❌'} (${contentLength} chars)`);
        
        // 8. Summary
        console.log('\n📊 Test Summary:');
        console.log(`   ✅ Invoice file loaded`);
        console.log(`   ✅ Base64 decoded successfully`);
        console.log(`   ✅ Size verification passed`);
        console.log(`   ✅ PDF header valid`);
        console.log(`   ✅ PDF structure valid`);
        console.log(`   ✅ PDF saved for inspection`);
        
        if (hasNullBytes) {
            console.log(`   ⚠️  Warning: Null bytes detected (may be normal for some PDFs)`);
        }
        
        console.log('\n🎉 Invoice_1016 test completed successfully!');
        console.log(`📁 Extracted PDF available at: ${outputPath}`);
        console.log(`🔍 You can manually open the PDF to verify it displays correctly`);
        
        return true;
        
    } catch (error) {
        console.error(`❌ Test failed with error: ${error.message}`);
        console.error(`   Stack trace: ${error.stack}`);
        return false;
    }
}

// Run the test
if (require.main === module) {
    testInvoice1016()
        .then(success => {
            if (success) {
                console.log('\n✅ All tests passed!');
                process.exit(0);
            } else {
                console.log('\n❌ Tests failed!');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error(`\n💥 Unexpected error: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { testInvoice1016 };
