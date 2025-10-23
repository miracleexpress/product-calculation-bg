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
const shop = process.env.SHOPIFY_SHOP;                 // örn: wjais8-qu.myshopify.com
const accessToken = process.env.SHOPIFY_ADMIN_API_KEY; // Admin API access token (write_products scope şart)

// Basit guard
function assertEnv() {
  if (!shop || !accessToken) {
    throw new Error("SHOPIFY_SHOP veya SHOPIFY_ADMIN_API_KEY çevre değişkeni eksik.");
  }
}

// -----------------------------------------
// Health Check
// -----------------------------------------
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "API is running" });
});

// -----------------------------------------
// Varyant Oluşturma (ID döner) Endpointi
// - Ürünün option'larını dinamik okur
// - selectedOptions'ı doğru isimlerle doldurur
// - İlk option'a özel/custom değer yazar, kalanlara mevcut ilk değerleri koyar
// -----------------------------------------
app.post("/create-custom-variant", async (req, res) => {
  try {
    assertEnv();
  } catch (e) {
    console.error(e.message);
    return res.status(500).json({ error: e.message });
  }

  const { productId, price, title = "Custom Size" } = req.body;

  if (!productId || price === undefined || price === null) {
    return res.status(400).json({ error: "productId and price are required" });
  }

  const productGid = `gid://shopify/Product/${productId}`;
  const optionValue = `${title} - ${Date.now().toString().slice(-4)}`;
  const sku = `custom-${Date.now()}`;

  try {
    // 1) Ürünün option ad/values listesini al
    const PRODUCT_OPTIONS_QUERY = `
      query ProductOptions($id: ID!) {
        product(id: $id) {
          id
          options {
            name
            values
          }
        }
      }
    `;

    const prodResp = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: PRODUCT_OPTIONS_QUERY, variables: { id: productGid } },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const prodData = prodResp?.data?.data?.product;
    if (!prodData) {
      console.error("Product read error:", prodResp?.data);
      return res.status(500).json({ error: "Product could not be read.", debug: prodResp?.data });
    }

    const options = Array.isArray(prodData.options) ? prodData.options : [];

    // 2) selectedOptions'ı ürünün gerçek option adlarıyla kur
    let selectedOptions = [];
    if (options.length === 0) {
      // Eski tip tek option'lı ürün kabul et: Title
      selectedOptions = [{ name: "Title", value: optionValue }];
    } else {
      // İlk option'a custom değer, kalan option'lara mevcut ilk değeri yaz
      selectedOptions = options.map((opt, idx) => {
        const name = opt?.name || "Title";
        if (idx === 0) {
          return { name, value: optionValue };
        }
        const firstVal =
          (Array.isArray(opt?.values) && opt.values.length > 0 && opt.values[0]) ||
          "Default Title";
        return { name, value: firstVal };
      });
    }

    // 3) Varyant yarat
    const CREATE_VARIANT_MUT = `
      mutation CreateVariant($input: ProductVariantInput!) {
        productVariantCreate(input: $input) {
          product { id }
          variant { id sku }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      input: {
        productId: productGid,
        price: price.toString(),
        sku,
        selectedOptions,
        // stok takibi yoksa stoksuz satış:
        inventoryPolicy: "CONTINUE",
        // stok takibi kullanıyorsanız inventoryQuantities ile miktar set edebilirsiniz.
      },
    };

    const variantResponse = await axios.post(
      `https://${shop}/admin/api/2024-07/graphql.json`,
      { query: CREATE_VARIANT_MUT, variables },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const raw = variantResponse?.data;
    const pv = raw?.data?.productVariantCreate;
    const errs = pv?.userErrors || [];

    // Ham yanıta ulaşabilelim diye loglayalım
    console.log("🔎 productVariantCreate raw:", JSON.stringify(raw, null, 2));

    if (errs.length) {
      // Hataları frontend'e aynen aktar ki konsolda görebilesiniz
      return res.status(500).json({
        error: "productVariantCreate userErrors",
        userErrors: errs,
        selectedOptions,
      });
    }

    const variantId = pv?.variant?.id;
    if (!variantId) {
      // Çok nadir: userErrors yok ama variant null – ham yanıtı ilet
      return res.status(500).json({
        error: "Variant ID could not be retrieved.",
        debug: raw,
        selectedOptions,
      });
    }

    // 4) Başarı
    return res.status(200).json({
      message: "Custom variant created successfully.",
      variantId,
      sku,
      option: optionValue,
      selectedOptions,
    });
  } catch (err) {
    console.error("Server error:", err?.response?.data || err.message);
    return res.status(500).json({
      error: err.message,
      debug: err?.response?.data,
    });
  }
});

// -----------------------------------------
// Sunucu Başlatma
// -----------------------------------------
app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
