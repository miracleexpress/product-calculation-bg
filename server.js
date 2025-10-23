// server.js
import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Shopify Admin API Config
const shop = process.env.SHOPIFY_SHOP;               // örn: your-store.myshopify.com
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY; // Admin API Access Token

// -----------------------------------------
// Health Check
// -----------------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "API is running" });
});

// -----------------------------------------
// Varyant Oluşturma (ID döner) Endpointi
// -----------------------------------------
app.post("/create-custom-variant", async (req, res) => {
  const { productId, price, title = "Custom Size" } = req.body;

  if (!productId || !price) {
    return res.status(400).json({ error: "productId and price are required" });
  }

  try {
    const productGid = `gid://shopify/Product/${productId}`;
    const optionValue = `${title} - ${Date.now().toString().slice(-4)}`;
    const sku = `custom-${Date.now()}`;

    // Tek adımda varyant yarat: productVariantCreate => ID döner
    const createVariantMutation = `
      mutation CreateVariant($input: ProductVariantInput!) {
        productVariantCreate(input: $input) {
          product { id }
          variant { id sku }
          userErrors { field message }
        }
      }
    `;

    // Not:
    // - Üründe tek option (Title) olduğunu varsayıyoruz.
    // - Eğer ürününüz Color/Size gibi option'lara sahipse, selectedOptions'ı hepsiyle doldurun.
    const variables = {
      input: {
        productId: productGid,
        price: price.toString(),
        sku,
        selectedOptions: [{ name: "Title", value: optionValue }],
        // Stok takibi yapmıyorsanız stoksuz satış için:
        inventoryPolicy: "CONTINUE",
        // Stok takibi yapıyorsanız miktar da atayabilirsiniz (örnek):
        // inventoryQuantities: [
        //   { availableQuantity: 999999, locationId: "gid://shopify/Location/XXXXXXX" }
        // ]
      }
    };

    const variantResponse = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: createVariantMutation, variables },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const data = variantResponse.data?.data?.productVariantCreate;
    const errs = data?.userErrors || [];
    if (errs.length) {
      console.error("Variant create error:", errs);
      return res.status(500).json({ error: errs });
    }

    const variantId = data?.variant?.id;
    if (!variantId) {
      return res.status(500).json({ error: "Variant ID could not be retrieved." });
    }

    return res.status(200).json({
      message: "Custom variant created successfully.",
      variantId,     // <-- Frontend'in beklediği alan
      sku,
      option: optionValue
    });

  } catch (err) {
    console.error("Server error:", err.response?.data || err.message);
    return res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------
// Sunucu Başlatma
// -----------------------------------------
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
