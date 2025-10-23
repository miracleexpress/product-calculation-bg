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

const shop = process.env.SHOPIFY_SHOP;
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY;

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'API is running' });
});

// Yeni varyant oluşturma endpointi (API 2024-07+)
app.post('/create-custom-variant', async (req, res) => {
  const { productId, price, title = 'Custom Size' } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: 'productId and price are required' });
  }

  const productGid = `gid://shopify/Product/${productId}`;
  const optionName = 'Custom Option';
  const optionValue = `${title} - ${Date.now().toString().slice(-4)}`;
  const sku = `custom-${Date.now()}`;

  try {
    // 1. Ürüne yeni bir option ekle
    const addOptionMutation = `
      mutation {
        productOptionsCreate(productId: "${productGid}", options: [
          {
            name: "${optionName}",
            values: ["${optionValue}"]
          }
        ]) {
          product { id }
          userErrors { field message }
        }
      }
    `;

    const optionResponse = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: addOptionMutation },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const optionErrors = optionResponse.data?.data?.productOptionsCreate?.userErrors;
    if (optionErrors?.length) {
      console.error('❌ Option create error:', optionErrors);
      return res.status(500).json({ error: optionErrors });
    }

    // 2. Yeni varyantı oluştur
    const createVariantMutation = `
      mutation {
        productVariantsBulkCreate(productId: "${productGid}", variants: [
          {
            price: "${price}",
            sku: "${sku}",
            options: ["${optionValue}"]
          }
        ]) {
          product { id }
          userErrors { field message }
        }
      }
    `;

    const variantResponse = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: createVariantMutation },
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const variantErrors = variantResponse.data?.data?.productVariantsBulkCreate?.userErrors;
    if (variantErrors?.length) {
      console.error('❌ Variant create error:', variantErrors);
      return res.status(500).json({ error: variantErrors });
    }

    return res.status(200).json({
      message: 'Custom variant created successfully.',
      sku,
      option: optionValue
    });

  } catch (err) {
    console.error('🚨 Server error:', err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
