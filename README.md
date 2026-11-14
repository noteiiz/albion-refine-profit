# Albion Refine Profit (Asia)

เว็บคำนวณกำไรการ Refine ของ Albion Online เซิร์ฟ Asia (East) บอกว่าควรซื้อวัตถุดิบจากเมืองไหน Refine ที่ไหน และขายที่ไหน พร้อมกราฟราคาย้อนหลัง

ราคามาจาก [Albion Online Data Project](https://www.albion-online-data.com/) ถ้าอยากให้ราคาสดขึ้น ให้รัน **Albion Data Client** ระหว่างเล่น แล้วไล่เปิดตลาดของที่สนใจในเกม

## มีอะไรบ้าง
- **ภาพรวมกำไร**: วัตถุดิบ Refine ทุกตัว (T2–T8 รวม Enchant .1–.4) เรียงตามกำไร
- **คำนวณรายไอเทม**: ซื้ออะไรที่ไหน ต้องซื้อเท่าไหร่ RRR ค่าสถานี ขายที่ไหน ขายได้วันละกี่ชิ้น และกำไรต่อ 1 Focus
- **ราคา & กราฟ**: ราคาปัจจุบันทุกเมือง กับกราฟราคาเฉลี่ยรายวัน
- **ตั้งค่าผู้เล่น**: Premium, Spec, ค่าสถานี และ Daily bonus เก็บไว้ในเบราว์เซอร์ (localStorage)

### กฎที่ตั้งไว้
- **Daily bonus**: ต้องระบุทุกวัน ถ้ายังไม่ใส่จะขึ้นแถบแดงและคำนวณไม่ได้ ขึ้นวันใหม่ (06:00 เวลาไทย ตามรอบ maintenance ของ Asia) ระบบจะถามใหม่ และลบข้อมูลที่เก่ากว่า 7 วันทิ้งอัตโนมัติ
- **ค่าสถานี**: ต้องใส่ก่อนคำนวณ เมืองที่ยังไม่ใส่จะไม่ถูกนำมาคำนวณ

## วิธีขึ้น GitHub (ครั้งแรก)
1. สมัครหรือล็อกอิน https://github.com แล้วกด **New repository** ตั้งชื่อ เช่น `albion-refine-profit` เลือก **Public** แล้วกด Create
2. ในหน้า repo ที่ว่างอยู่ กด **uploading an existing file** แล้วลากไฟล์และโฟลเดอร์ทั้งหมดในโปรเจกต์นี้เข้าไป แล้วกด **Commit changes**
   - โฟลเดอร์ `.github` เป็นโฟลเดอร์ซ่อน ถ้าลากไม่ติด ให้กด **Add file → Create new file** พิมพ์ชื่อ `.github/workflows/update-prices.yml` แล้ววางเนื้อหาไฟล์นั้นลงไป
3. เปิดเว็บ: ไปที่ **Settings → Pages** ตรง Source เลือก **Deploy from a branch** เลือก Branch `main` โฟลเดอร์ `/ (root)` แล้วกด Save รอ 1–2 นาที เว็บจะอยู่ที่ `https://<ชื่อผู้ใช้>.github.io/albion-refine-profit/`
4. เปิดการอัปเดตราคาอัตโนมัติ: ไปที่ **Settings → Actions → General** ตรง Workflow permissions เลือก **Read and write permissions** แล้ว Save จากนั้นไปแท็บ **Actions** เลือก **Update market prices** แล้วกด **Run workflow** 1 ครั้ง หลังจากนั้นจะรันเองทุก 3 ชั่วโมง

> เว็บดึงราคาสดจาก API ทุกครั้งที่เปิดอยู่แล้ว ส่วน Actions มีไว้เก็บราคาสำรองและประวัติราคาระยะยาวของเราเอง (180 วัน) ไว้ใน `data/history.json`

## โครงสร้างไฟล์
```
index.html                     หน้าเว็บ
assets/app.js                  ตรรกะการคำนวณทั้งหมด
assets/style.css               หน้าตา
data/config.json               ตัวเลขของเกม (ภาษี, โบนัสเมือง, RRR, เวลารีเซ็ต) แก้ที่นี่ได้
data/recipes.json              สูตร Refine จากไฟล์เกม (ao-bin-dumps)
data/prices.json               ราคาล่าสุด (Actions อัปเดตให้)
data/history.json              ประวัติราคาที่เก็บเอง
scripts/update-prices.mjs      สคริปต์ดึงราคา
.github/workflows/...          ตั้งเวลารันสคริปต์
```

## สูตรที่ใช้
- **RRR** = 1 − 1 / (1 + Production bonus)
  - Production bonus = 18% (ฐาน) + 40% (ถ้าเป็นเมืองที่มีโบนัสวัตถุดิบนั้น) + 59% (ถ้าใช้ Focus) + Daily bonus (10% หรือ 20%)
  - เมืองโบนัส: Fort Sterling = ไม้, Lymhurst = ใย, Bridgewatch = หิน, Martlock = หนัง, Thetford = แร่
- **ต้นทุน/ชิ้น** = ราคาวัตถุดิบรวม × (1 − RRR) + ค่าสถานี
- **ค่าสถานี/ชิ้น** = Item value × 0.1125 × (ค่าสถานีที่ใส่ / 100)
- **ได้สุทธิเมื่อขาย** = ราคา × (1 − ภาษี − setup fee 2.5% ถ้าตั้ง Sell order) โดยภาษีคือ 4% สำหรับ Premium และ 8% สำหรับไม่ Premium
- **กรองราคาผิดปกติ**: ราคาที่ต่างจากค่ากลางของทุกเมืองเกิน 2.5 เท่า (`outlierFactor`) จะไม่ถูกเลือกเป็นจุดซื้อหรือขายที่ดีที่สุด
- **Focus จาก Spec** เป็นค่าประมาณ (ดู `focusEstimate` ใน config) ถ้าไม่ตรงกับในเกม ให้กรอก Focus จริงในหน้าคำนวณแทน

ไม่ได้มีส่วนเกี่ยวข้องกับ Sandbox Interactive GmbH
