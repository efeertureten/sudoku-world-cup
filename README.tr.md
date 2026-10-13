<div align="center">

<img src="apps/web/public/favicon.svg" width="72" alt="" />

# Sudoku World Cup

**Gerçek zamanlı 1v1 Sudoku yarışları, eleme usulü kupalar ve ülke sıralaması.**
İki oyuncu aynı tahtayı aynı anda alır. Tahtayı ilk bitiren kazanır ve her galibiyet ülkene puan yazar.

[English](README.md) · [Mimari](docs/ARCHITECTURE.md) · [Socket protokolü](docs/PROTOCOL.md) · [Katkı rehberi](CONTRIBUTING.md)

[![GitHub Codespaces'ta aç](https://github.com/codespaces/badge.svg)](https://codespaces.new/efeertureten/sudoku-world-cup?quickstart=1)

<img src="docs/screenshots/match.png" width="860" alt="Canlı maç ekranı" />

</div>

## Özellikler

- **Kafa kafaya yarış.** İki oyuncu tek çözümlü aynı bulmacayı çözer; her rakamı sunucu doğrular. Yanlış rakam girişi 3 saniye dondurur, üçüncü hata kırmızı karttır.
- **Anında eşleştirme.** Puan tabanlı kuyruk; beklerken arama aralığı genişler. 5 saniyede rakip çıkmazsa insan gibi oynayan, her zaman "Bot" rozetiyle gösterilen bir bot gelir.
- **World Cup kupaları.** 16 kişilik tek eleme; kupaya göre seri başı, her turda daha zor bulmaca, boş koltuklara botlar.
- **Ülke sıralaması.** Galibiyetler temsil ettiğin ülkeye puan yazar; toplam puana ya da her ülkenin en iyi 50 oyuncusuna göre sıralanır. Botlara karşı galibiyetler de günlük sınırla biraz puan getirir; böylece küçük sunucularda da tablo canlı kalır ama kimse botlarla puan kasamaz.
- **Herkese açık maç tekrarları.** Biten her maçın iki tahtayı yan yana oynatan, paylaşılabilir bir tekrarı var. Bir düğmeyle bulmaca tarayıcında seed'den yeniden üretilir ve maçın adil oynandığı doğrulanır.
- **İlerleme.** Kupalar, altı lig, altın; JSON ile tanımlanan, kilidi açılan tahta temaları ve formalar.
- **Adil oyun.** Çözüm ve seed maç boyunca tarayıcıya hiç gitmez; hamleler Redis içinde atomik doğrulanır; biten maçlar seed'iyle yayınlanır, herkes doğrulayabilir.

## Tarayıcıda dene

Kurulum gerekmez: yukarıdaki **Open in GitHub Codespaces** düğmesine bas ve yaklaşık iki dakika bekle. Codespace her şeyi derleyip başlatır ve oyunu 8080 portunda açar (açılmazsa **Ports** sekmesinde 8080'in yanındaki küre simgesine tıkla).

- **Bota karşı:** *Rakip bul*'a bas; 5 saniye içinde bir bot gelir.
- **Bir insana karşı:** aynı adresi gizli pencerede de aç ve iki pencereden sıraya gir, ya da Ports sekmesinde 8080'i *Public* yapıp bağlantıyı bir arkadaşına gönder.
- **Kupa:** *Kupaya katıl*'a bas; 60 saniye sonra boş koltukları botlar doldurur.

## Hızlı başlangıç

Docker ve Compose v2 yeterli.

```bash
git clone https://github.com/efeertureten/sudoku-world-cup.git
cd sudoku-world-cup
docker compose up --build
```

**http://localhost:8080** adresini aç, bir isim ve ülke seç, *Sahaya çık*'a bas. İlk açılışta imajlar derlenir ve bulmaca havuzu üretilir; sonraki açılışlar saniyeler sürer.

`.env` dosyası gerekmez. Port, şifre veya oyun ayarlarını (bot gecikmesi, maç süresi, kupa dolum süresi) değiştirmek için [`.env.example`](.env.example) dosyasını `.env` olarak kopyala.

## Yerel geliştirme

Gereksinimler: Node.js 22, pnpm 10 (`corepack enable`), Postgres ve Redis için Docker.

```bash
pnpm install
pnpm infra:up        # Postgres :5432 ve Redis :6379
pnpm dev             # API :3000, web http://localhost:5173 (anında yenileme)
```

`pnpm check` lint, tip kontrolü ve tüm testleri çalıştırır (entegrasyon testleri için `pnpm infra:up` açık olmalı).

## Ekran görüntüleri

| Lobi | Maç sonu | Kupa tablosu |
| --- | --- | --- |
| <img src="docs/screenshots/home.png" alt="Lobi" /> | <img src="docs/screenshots/result.png" alt="Maç sonu kartı" /> | <img src="docs/screenshots/bracket.png" alt="16 kişilik eleme tablosu" /> |

Daha fazlası ve mimarinin ayrıntıları için [İngilizce README](README.md) ve [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Katkı

Hata düzeltmeleri, çeviriler, yeni tahta temaları ve formalar memnuniyetle karşılanır. [CONTRIBUTING.md](CONTRIBUTING.md) ile başla; `good first issue` etiketli konular iyi bir giriş noktası.

Hile açığı bulursan lütfen herkese açık issue açma, [SECURITY.md](SECURITY.md) üzerinden bildir.

## Lisans

[MIT](LICENSE). Futbol temalı bir hayran projesidir; FIFA veya herhangi bir futbol federasyonuyla bağlantısı yoktur ve onların adlarını, amblemlerini ya da kupalarını kullanmaz.
