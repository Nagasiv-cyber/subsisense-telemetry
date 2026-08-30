const { MongoClient } = require('mongodb');
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

(async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'smart_subsidence');
    const col = db.collection('readings');

    const docs = await col.find({}).toArray();
    let updatedCount = 0;

    for (const doc of docs) {
      let changed = false;
      let updateFields = {};

      if (doc.tension && /^[01]{6,}$/.test(String(doc.tension))) {
        updateFields.tension = parseInt(String(doc.tension), 2);
        changed = true;
      }
      if (doc.loadDifference && /^[01]{6,}$/.test(String(doc.loadDifference))) {
        updateFields.loadDifference = parseInt(String(doc.loadDifference), 2);
        changed = true;
      }
      if (doc.displacement && /^[01]{6,}$/.test(String(doc.displacement))) {
        updateFields.displacement = parseInt(String(doc.displacement), 2);
        changed = true;
      }

      if (changed) {
        await col.updateOne({ _id: doc._id }, { $set: updateFields });
        updatedCount++;
      }
    }

    console.log(`✅ Successfully sanitized and converted ${updatedCount} historical records into proper decimal numbers in MongoDB Atlas!`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
