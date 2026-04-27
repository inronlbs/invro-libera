const fs = require('fs');

async function testFetch() {
    try {
        // Book ID is needed to fetch. Let's find one by looking at book_catalog.json
        const catalogData = fs.readFileSync('C:/Users/Atomix/AppData/Roaming/com.invronlabs.elibrary.host/book_catalog.json', 'utf8');
        const catalog = JSON.parse(catalogData);
        const epubBook = catalog.books.find(b => b.type === 'epub');
        
        if (!epubBook) {
            console.log("No EPUB books found in catalog.");
            return;
        }

        console.log(`Found EPUB book: ${epubBook.title} (ID: ${epubBook.id})`);
        
        const response = await fetch(`http://127.0.0.1:3000/api/books/${epubBook.id}`);
        if (!response.ok) {
             console.error(`Fetch failed with status: ${response.status}`);
             return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log(`Fetched ${buffer.length} bytes.`);
        
        // Print first 4 bytes. For ZIP/EPUB, it should be 50 4B 03 04 ("PK\x03\x04")
        console.log("First 4 bytes:", buffer.subarray(0, 4).toString('hex'));
        
        // Save the first 100 bytes to see what it is
        console.log("Snippet:", buffer.subarray(0, 100).toString('utf8'));
    } catch (e) {
        console.error("Error:", e);
    }
}

testFetch();
