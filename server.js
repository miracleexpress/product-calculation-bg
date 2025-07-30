// server.js
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Shopify Admin API Config
const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;

console.log("🧪 Shopify shop:", process.env.SHOPIFY_SHOP);
console.log("🔑 Token prefix:", process.env.SHOPIFY_ADMIN_API_KEY?.substring(0, 10));

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// —————————————————————————————————————————————
// Varyant Oluşturma ve Metafield Güncelleme Endpointi
// —————————————————————————————————————————————
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size' } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: 'productId and price are required' });
  }

  try {
    console.log("📦 Gelen productId:", productId);
    console.log("💰 Fiyat:", price);

    const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
    const optionTitle = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;

    const variantMutation = `
      mutation {
        productVariantCreate(input: {
          productId: "${productGid}",
          price: "${price}",
          sku: "${sku}",
          options: ["${optionTitle}"],
          inventoryManagement: null,
          inventoryPolicy: CONTINUE
        }) {
          productVariant { id }
          userErrors { field message }
        }
      }
    `;
    console.log("📤 Shopify mutation:", variantMutation);

    const variantResponse = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: variantMutation },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    const variantData = variantResponse.data?.data?.productVariantCreate;
    if (!variantData || variantData.userErrors.length) {
      console.error('❌ Variant creation error:', JSON.stringify(variantResponse.data, null, 2));
      console.log("🧩 Full response:", JSON.stringify(variantResponse.data, null, 2));
      return res.status(500).json({ error: variantData?.userErrors || 'Variant creation failed' });
    }

    const variantId = variantData.productVariant.id;

    const metafieldMutation = `
      mutation {
        metafieldsSet(metafields: [
          {
            namespace: "prune",
            key: "isdeletable",
            ownerId: "${variantId}",
            type: "boolean",
            value: "true"
          }
        ]) {
          metafields { id namespace key value }
          userErrors { field message }
        }
      }
    `;

    const mfResponse = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: metafieldMutation },
      { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    const mfData = mfResponse.data?.data?.metafieldsSet;
    let isDeletable = false;
    if (mfData && !mfData.userErrors.length) {
      isDeletable = true;
    } else {
      console.warn('⚠️ Metafield update warnings/errors:', JSON.stringify(mfResponse.data, null, 2));
    }

    return res.status(200).json({ variantId, sku, isDeletable });

  } catch (err) {
    console.error('🚨 Server error:', JSON.stringify(err, null, 2));
    return res.status(500).json({ error: err.message });
  }
});

// —————————————————————————————————————————————
// Admin API introspection test endpointi
// —————————————————————————————————————————————
app.get('/introspection-test', async (req, res) => {
  try {
    const introspectionTest = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      {
        query: `
          {
            __schema {
              mutationType {
                fields {
                  name
                }
              }
            }
          }
        `
      },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    console.dir(introspectionTest.data, { depth: null });
    res.status(200).json(introspectionTest.data);
  } catch (error) {
    console.error("❌ Introspection error:", error.response?.data || error.message);
    res.status(500).json({ error: error.message });
  }
});

// —————————————————————————————————————————————
// Sunucu Başlatma
// —————————————————————————————————————————————
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
