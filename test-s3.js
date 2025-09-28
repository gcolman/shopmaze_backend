#!/usr/bin/env node

/**
 * Standalone S3 Client Test Application
 * Tests the MinIO S3 client functionality
 */

const { S3Client } = require('./src/shared/s3');

class S3Tester {
    constructor() {
        this.s3 = new S3Client();
        this.testResults = {
            passed: 0,
            failed: 0,
            tests: []
        };
    }

    /**
     * Run a test and track results
     * @param {string} testName - Name of the test
     * @param {Function} testFunction - Async function to run
     */
    async runTest(testName, testFunction) {
        console.log(`\n🧪 Running test: ${testName}`);
        console.log('═'.repeat(50));
        
        try {
            const startTime = Date.now();
            const result = await testFunction();
            const duration = Date.now() - startTime;
            
            console.log(`✅ Test passed: ${testName} (${duration}ms)`);
            this.testResults.passed++;
            this.testResults.tests.push({
                name: testName,
                status: 'PASSED',
                duration: duration,
                result: result
            });
            
            return result;
        } catch (error) {
            console.error(`❌ Test failed: ${testName}`);
            console.error(`   Error: ${error.message}`);
            this.testResults.failed++;
            this.testResults.tests.push({
                name: testName,
                status: 'FAILED',
                error: error.message
            });
            
            throw error;
        }
    }

    /**
     * Test connection to MinIO server
     */
    async testConnection() {
        return this.runTest('Connection Test', async () => {
            console.log('📡 Testing connection to MinIO server...');
            
            // Display connection info
            const connInfo = this.s3.getConnectionInfo();
            console.log(`🔗 Connecting to: ${connInfo.endPoint}:${connInfo.port}`);
            console.log(`🔒 SSL: ${connInfo.useSSL ? 'Enabled' : 'Disabled'}`);
            console.log(`🌍 Region: ${connInfo.region}`);
            
            const connected = await this.s3.connect();
            
            if (connected && this.s3.isConnected()) {
                console.log('✅ Successfully connected to MinIO server');
                return { connected: true };
            } else {
                throw new Error('Connection failed or not properly established');
            }
        });
    }

    /**
     * Test listing buckets
     */
    async testListBuckets() {
        return this.runTest('List Buckets', async () => {
            console.log('📂 Testing bucket listing...');
            
            const buckets = await this.s3.listBuckets();
            
            console.log(`📂 Found ${buckets.length} buckets:`);
            buckets.forEach((bucket, index) => {
                console.log(`   ${index + 1}. ${bucket.name} (created: ${bucket.creationDate})`);
            });
            
            return { bucketCount: buckets.length, buckets: buckets };
        });
    }

    /**
     * Test listing objects in first available bucket
     */
    async testListObjects(buckets) {
        if (!buckets || buckets.length === 0) {
            console.log('⚠️  No buckets available for object listing test');
            return { objectCount: 0, objects: [] };
        }

        const bucketName = buckets[0].name;
        
        return this.runTest('List Objects', async () => {
            console.log(`📋 Testing object listing in bucket '${bucketName}'...`);
            
            const objects = await this.s3.listObjects(bucketName);
            
            console.log(`📋 Found ${objects.length} objects in '${bucketName}':`);
            objects.slice(0, 10).forEach((obj, index) => {
                const sizeKB = (obj.size / 1024).toFixed(2);
                console.log(`   ${index + 1}. ${obj.name} (${sizeKB} KB, modified: ${obj.lastModified})`);
            });
            
            if (objects.length > 10) {
                console.log(`   ... and ${objects.length - 10} more objects`);
            }
            
            return { bucketName: bucketName, objectCount: objects.length, objects: objects };
        });
    }

    /**
     * Test fetching a specific object
     */
    async testFetchObject(objectInfo) {
        if (!objectInfo || objectInfo.objectCount === 0) {
            console.log('⚠️  No objects available for fetch test');
            return { fetched: false };
        }

        const bucketName = objectInfo.bucketName;
        const objectName = objectInfo.objects[0].name;
        
        return this.runTest('Fetch Object', async () => {
            console.log(`📥 Testing object fetch: '${objectName}' from '${bucketName}'...`);
            
            // Get object stats first
            const stats = await this.s3.getObjectStat(bucketName, objectName);
            console.log(`📊 Object stats: ${stats.size} bytes, ETag: ${stats.etag}`);
            
            // Fetch the object
            const data = await this.s3.getObject(bucketName, objectName);
            console.log(`📥 Successfully fetched ${data.length} bytes`);
            
            // Try to fetch as string if it's small and likely text
            let contentPreview = null;
            if (stats.size < 1024 && (objectName.endsWith('.txt') || objectName.endsWith('.json') || objectName.endsWith('.xml'))) {
                try {
                    const textContent = await this.s3.getObjectAsString(bucketName, objectName);
                    contentPreview = textContent.substring(0, 200) + (textContent.length > 200 ? '...' : '');
                    console.log(`📄 Content preview: ${contentPreview}`);
                } catch (error) {
                    console.log(`⚠️  Could not read as text: ${error.message}`);
                }
            }
            
            return { 
                bucketName: bucketName,
                objectName: objectName, 
                size: data.length,
                contentPreview: contentPreview
            };
        });
    }

    /**
     * Test object search functionality
     */
    async testSearchObjects(objectInfo) {
        if (!objectInfo || objectInfo.objectCount === 0) {
            console.log('⚠️  No objects available for search test');
            return { searchResults: 0 };
        }

        const bucketName = objectInfo.bucketName;
        
        return this.runTest('Search Objects', async () => {
            console.log(`🔍 Testing object search in bucket '${bucketName}'...`);
            
            // Test different search patterns
            const patterns = ['*', '*.jpg', '*.png', '*.json', '*.txt'];
            const searchResults = {};
            
            for (const pattern of patterns) {
                try {
                    const results = await this.s3.searchObjects(bucketName, pattern);
                    searchResults[pattern] = results.length;
                    console.log(`🔍 Pattern '${pattern}': ${results.length} matches`);
                    
                    if (results.length > 0 && results.length <= 5) {
                        results.forEach(obj => {
                            console.log(`     - ${obj.name}`);
                        });
                    }
                } catch (error) {
                    console.log(`⚠️  Pattern '${pattern}' failed: ${error.message}`);
                    searchResults[pattern] = -1;
                }
            }
            
            return { bucketName: bucketName, searchResults: searchResults };
        });
    }

    /**
     * Test presigned URL generation
     */
    async testPresignedUrl(objectInfo) {
        if (!objectInfo || objectInfo.objectCount === 0) {
            console.log('⚠️  No objects available for presigned URL test');
            return { urlGenerated: false };
        }

        const bucketName = objectInfo.bucketName;
        const objectName = objectInfo.objects[0].name;
        
        return this.runTest('Presigned URL', async () => {
            console.log(`🔗 Testing presigned URL generation for '${objectName}'...`);
            
            const expiry = 300; // 5 minutes
            const url = await this.s3.getPresignedUrl(bucketName, objectName, expiry);
            
            console.log(`🔗 Generated presigned URL (expires in ${expiry}s):`);
            console.log(`   ${url.substring(0, 100)}...`);
            
            return { 
                bucketName: bucketName,
                objectName: objectName,
                url: url,
                expiry: expiry
            };
        });
    }

    /**
     * Test object existence check
     */
    async testObjectExists(objectInfo) {
        if (!objectInfo || objectInfo.objectCount === 0) {
            console.log('⚠️  No objects available for existence test');
            return { tested: false };
        }

        const bucketName = objectInfo.bucketName;
        const objectName = objectInfo.objects[0].name;
        
        return this.runTest('Object Existence', async () => {
            console.log(`❓ Testing object existence checks...`);
            
            // Test existing object
            const exists = await this.s3.objectExists(bucketName, objectName);
            console.log(`✅ Object '${objectName}' exists: ${exists}`);
            
            // Test non-existing object
            const fakeObjectName = 'non-existent-file-' + Date.now() + '.txt';
            const notExists = await this.s3.objectExists(bucketName, fakeObjectName);
            console.log(`❌ Object '${fakeObjectName}' exists: ${notExists}`);
            
            return { 
                bucketName: bucketName,
                existingObject: { name: objectName, exists: exists },
                nonExistingObject: { name: fakeObjectName, exists: notExists }
            };
        });
    }

    /**
     * Print test summary
     */
    printSummary() {
        console.log('\n' + '═'.repeat(60));
        console.log('📊 TEST SUMMARY');
        console.log('═'.repeat(60));
        
        console.log(`✅ Passed: ${this.testResults.passed}`);
        console.log(`❌ Failed: ${this.testResults.failed}`);
        console.log(`📊 Total:  ${this.testResults.passed + this.testResults.failed}`);
        
        const successRate = this.testResults.passed + this.testResults.failed > 0 
            ? (this.testResults.passed / (this.testResults.passed + this.testResults.failed) * 100).toFixed(1)
            : 0;
        console.log(`📈 Success Rate: ${successRate}%`);
        
        console.log('\n📋 Detailed Results:');
        this.testResults.tests.forEach((test, index) => {
            const status = test.status === 'PASSED' ? '✅' : '❌';
            const duration = test.duration ? ` (${test.duration}ms)` : '';
            console.log(`   ${index + 1}. ${status} ${test.name}${duration}`);
            if (test.status === 'FAILED') {
                console.log(`      Error: ${test.error}`);
            }
        });
        
        console.log('\n' + '═'.repeat(60));
    }

    /**
     * Run all tests
     */
    async runAllTests() {
        console.log('🚀 Starting S3 Client Test Suite');
        console.log('═'.repeat(60));
        
        try {
            // Test 1: Connection
            await this.testConnection();
            
            // Test 2: List buckets
            const bucketResult = await this.testListBuckets();
            
            // Test 3: List objects (if buckets exist)
            const objectResult = await this.testListObjects(bucketResult.buckets);
            
            // Test 4: Fetch object (if objects exist)
            await this.testFetchObject(objectResult);
            
            // Test 5: Search objects (if objects exist)
            await this.testSearchObjects(objectResult);
            
            // Test 6: Generate presigned URL (if objects exist)
            await this.testPresignedUrl(objectResult);
            
            // Test 7: Test object existence (if objects exist)
            await this.testObjectExists(objectResult);
            
        } catch (error) {
            console.error(`\n💥 Test suite stopped due to critical error: ${error.message}`);
        } finally {
            this.printSummary();
        }
        
        // Exit with appropriate code
        process.exit(this.testResults.failed > 0 ? 1 : 0);
    }
}

/**
 * Main function
 */
async function main() {
    console.log('🧪 S3 Client Test Application');
    console.log('Testing MinIO S3 client functionality\n');
    
    const tester = new S3Tester();
    
    // Handle interruption gracefully
    process.on('SIGINT', () => {
        console.log('\n\n⚠️  Test interrupted by user');
        tester.printSummary();
        process.exit(1);
    });
    
    await tester.runAllTests();
}

// Run if this file is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Fatal error:', error.message);
        process.exit(1);
    });
}

module.exports = { S3Tester };
