/**
 * Set CORS on Firebase Storage bucket.
 * Run: node set-cors.js
 */
const { Storage } = require('@google-cloud/storage');

const BUCKET = 'invronteach.firebasestorage.app';

const corsConfig = [
  {
    origin: ['*'],
    method: ['GET', 'HEAD'],
    maxAgeSeconds: 3600,
    responseHeader: [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'Content-Disposition',
    ],
  },
];

async function main() {
  // Uses Application Default Credentials (ADC).
  // If not logged in, run: gcloud auth application-default login
  // Or set GOOGLE_APPLICATION_CREDENTIALS env var to a service account JSON key.
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET);

  await bucket.setCorsConfiguration(corsConfig);
  console.log(`✓ CORS set on gs://${BUCKET}`);

  // Verify
  const [metadata] = await bucket.getMetadata();
  console.log('Current CORS:', JSON.stringify(metadata.cors, null, 2));
}

main().catch(err => {
  console.error('Failed to set CORS:', err.message);
  if (err.message.includes('Could not load the default credentials')) {
    console.error('\nTo fix this, run one of:');
    console.error('  1. gcloud auth application-default login');
    console.error('  2. Set GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json');
  }
  process.exit(1);
});
