import http.server
import socketserver
import json
import os
import urllib.parse
import time

PORT = 8080
DIRECTORY = "."

# Generate initial seed JSON on disk if not present
def initialize_seed_data():
    filepath = "menu_data.json"
    
    # Complete category list matching seed.js
    categories = [
      {"id": "cat-quick-bites", "name": "Quick Bites", "section": "food", "display_order": 1, "visible": True},
      {"id": "cat-sushi-dimsum", "name": "Sushi & Dimsum", "section": "food", "display_order": 2, "visible": True},
      {"id": "cat-oriental-appetizers", "name": "Oriental Appetizers", "section": "food", "display_order": 3, "visible": True},
      {"id": "cat-indian-appetizers", "name": "Indian Appetizers", "section": "food", "display_order": 4, "visible": True},
      {"id": "cat-indian-main", "name": "Indian Main Course", "section": "food", "display_order": 5, "visible": True},
      {"id": "cat-oriental-main", "name": "Oriental Main Course", "section": "food", "display_order": 6, "visible": True},
      {"id": "cat-breads", "name": "Breads", "section": "food", "display_order": 7, "visible": True},
      {"id": "cat-desserts", "name": "Desserts", "section": "food", "display_order": 8, "visible": True},
      {"id": "cat-fresh-beer", "name": "Fresh Beer (Draught)", "section": "drinks", "display_order": 1, "visible": True},
      {"id": "cat-bottled-beer", "name": "Chilled Bottled Beer", "section": "drinks", "display_order": 2, "visible": True},
      {"id": "cat-sig-cocktails", "name": "Luka Signature Cocktails", "section": "drinks", "display_order": 3, "visible": True},
      {"id": "cat-classic-cocktails", "name": "Classic Cocktails", "section": "drinks", "display_order": 4, "visible": True},
      {"id": "cat-shooters", "name": "Shooters", "section": "drinks", "display_order": 5, "visible": True},
      {"id": "cat-tequilas", "name": "Tequilas", "section": "drinks", "display_order": 6, "visible": True},
      {"id": "cat-liqueurs", "name": "Liqueurs", "section": "drinks", "display_order": 7, "visible": True},
      {"id": "cat-mocktails", "name": "Mocktails", "section": "drinks", "display_order": 8, "visible": True},
      {"id": "cat-beverages", "name": "Non-Alcoholic Beverages", "section": "drinks", "display_order": 9, "visible": True}
    ]

    items = [
      # FOOD: Quick Bites
      {
        "id": "item-crispy-corn",
        "category_id": "cat-quick-bites",
        "name": "Crispy Corn Kernels",
        "description": "Deep fried corn tossed with spices, garlic, onion, and fresh cilantro.",
        "tags": ["Veg", "Spicy", "Bestseller"],
        "availability": "Available",
        "media": ["uploads/crispy_corn.png"],
        "price_variants": [{"label": "Portion", "price": 375}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-spring-rolls",
        "category_id": "cat-quick-bites",
        "name": "Downtown Spring Rolls",
        "description": "Crispy roll skins filled with seasoned julienned vegetables, served with sweet chili dip.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 375}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-onion-rings",
        "category_id": "cat-quick-bites",
        "name": "Crispy Onion Rings",
        "description": "Golden batter-fried onion rings served with creamy garlic dip.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 275}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-caesar-salad-veg",
        "category_id": "cat-quick-bites",
        "name": "Luka Caesar Salad (Veg)",
        "description": "Fresh romaine lettuce tossed with parmesan cheese, garlic croutons, and Caesar dressing.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 375}],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-caesar-salad-chk",
        "category_id": "cat-quick-bites",
        "name": "Luka Caesar Salad (Chicken)",
        "description": "Romaine lettuce, grilled chicken breast slices, garlic croutons, parmesan, Caesar dressing.",
        "tags": ["Non-Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 475}],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-kathi-roll-veg",
        "category_id": "cat-quick-bites",
        "name": "Paneer Kathi Roll",
        "description": "Skewered paneer and bell peppers wrapped in a soft roomali flatbread with mint chutney.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 375}],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-kathi-roll-chk",
        "category_id": "cat-quick-bites",
        "name": "Chicken Kathi Roll",
        "description": "Spicy tandoori chicken chunks wrapped in flatbread with onions and green pepper rings.",
        "tags": ["Non-Veg", "Spicy"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 425}],
        "display_order": 7,
        "status": "Published"
      },

      # FOOD: Sushi & Dimsum
      {
        "id": "item-sushi-cali",
        "category_id": "cat-sushi-dimsum",
        "name": "Veg California Roll (8pcs)",
        "description": "Classic rolled sushi with cucumber, avocado, carrot, coated with sesame seeds.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "8 Pcs", "price": 525}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-sushi-salmon",
        "category_id": "cat-sushi-dimsum",
        "name": "Salmon Tempura Roll (8pcs)",
        "description": "Crispy salmon tempura and avocado rolled with nori sheets, served with gari and wasabi.",
        "tags": ["Non-Veg", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "8 Pcs", "price": 675}],
        "display_order": 2,
        "status": "Published"
      },

      # FOOD: Oriental Appetizers
      {
        "id": "item-chilli-paneer",
        "category_id": "cat-oriental-appetizers",
        "name": "Chilli Paneer Dry",
        "description": "Cottage cheese chunks sautéed with green bell peppers, red onions, and hot green chillies in dark soy-garlic sauce.",
        "tags": ["Veg", "Spicy", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 445}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-honey-potato",
        "category_id": "cat-oriental-appetizers",
        "name": "Honey Chilli Potato",
        "description": "Crisp potato batons tossed in a sticky, sweet honey glaze with sesame seeds and red chillies.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 395}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-chilli-chicken",
        "category_id": "cat-oriental-appetizers",
        "name": "Chilli Chicken Dry",
        "description": "Crispy corn-crusted chicken cubes tossed with scallions, green chillies, and bell peppers in spicy soy reduction.",
        "tags": ["Non-Veg", "Spicy", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 525}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-chilli-fish",
        "category_id": "cat-oriental-appetizers",
        "name": "Chilli Fish Dry",
        "description": "Sole fish fillet pieces fried crispy and tossed in house hot garlic and soy sauce.",
        "tags": ["Non-Veg", "Spicy"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 645}],
        "display_order": 4,
        "status": "Published"
      },

      # FOOD: Indian Appetizers
      {
        "id": "item-murgh-tikka",
        "category_id": "cat-indian-appetizers",
        "name": "Tandoori Murgh Tikka",
        "description": "Tender boneless chicken thigh pieces marinated in red chili yogurt paste and tandoori spices, char-grilled.",
        "tags": ["Non-Veg", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 545}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-paneer-tikka",
        "category_id": "cat-indian-appetizers",
        "name": "Lal Mirch Ka Paneer Tikka",
        "description": "Fresh blocks of paneer layered with yogurt marinade, mathania chillies, grilled in tandoor clay oven.",
        "tags": ["Veg", "Spicy"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 425}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-mutton-seekh",
        "category_id": "cat-indian-appetizers",
        "name": "Tandoori Mutton Seekh",
        "description": "Minced lamb infused with ground coriander, cloves, fresh ginger and mint, char-skewered.",
        "tags": ["Non-Veg", "Spicy", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 645}],
        "display_order": 3,
        "status": "Published"
      },

      # FOOD: Indian Main Course
      {
        "id": "item-dal-makhani",
        "category_id": "cat-indian-main",
        "name": "Dal Makhani",
        "description": "Slow-cooked black lentils and red kidney beans simmered overnight with butter, fresh tomato puree, and cream.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 395}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-paneer-butter",
        "category_id": "cat-indian-main",
        "name": "Paneer Butter Masala",
        "description": "Soft cottage cheese chunks cooked in a rich, creamy, orange tomato-butter sauce.",
        "tags": ["Veg", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 425}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-butter-chicken",
        "category_id": "cat-indian-main",
        "name": "Downtown Butter Chicken",
        "description": "Clay-oven grilled shredded tandoori chicken cooked in a rich, velvety, aromatic buttery gravy.",
        "tags": ["Non-Veg", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 525}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-mutton-rogan",
        "category_id": "cat-indian-main",
        "name": "Mutton Rogan Josh Kashmiri",
        "description": "Tender lamb cuts slow-braised in a rich, aromatic gravy featuring mawal flower and Kashmiri spices.",
        "tags": ["Non-Veg", "Spicy"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 645}],
        "display_order": 4,
        "status": "Published"
      },

      # FOOD: Oriental Main Course
      {
        "id": "item-veg-manchurian",
        "category_id": "cat-oriental-main",
        "name": "Veg Manchurian Gravy",
        "description": "Hand-rolled vegetable fritter balls cooked in a thick ginger, garlic, soy, and spring onion gravy.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 395}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-hot-garlic-chicken",
        "category_id": "cat-oriental-main",
        "name": "Chicken in Hot Garlic Sauce",
        "description": "Sliced chicken breast sautéed with bell peppers and onions in a hot, sweet and sour garlic paste gravy.",
        "tags": ["Non-Veg", "Spicy"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 475}],
        "display_order": 2,
        "status": "Published"
      },

      # FOOD: Breads
      {
        "id": "item-roti",
        "category_id": "cat-breads",
        "name": "Tandoori Roti",
        "description": "Whole wheat unleavened bread baked in the tandoor.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Plain", "price": 75},
          {"label": "Butter", "price": 95}
        ],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-naan",
        "category_id": "cat-breads",
        "name": "Tandoori Naan",
        "description": "Fine flour leavened clay-baked flatbread.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Plain", "price": 95},
          {"label": "Butter", "price": 115},
          {"label": "Garlic", "price": 135}
        ],
        "display_order": 2,
        "status": "Published"
      },

      # FOOD: Desserts
      {
        "id": "item-brownie",
        "category_id": "cat-desserts",
        "name": "Hot Fudge Brownie",
        "description": "Warm walnut fudge brownie served with a scoop of premium vanilla bean ice cream and hot chocolate fudge drizzle.",
        "tags": ["Veg", "Bestseller"],
        "availability": "Available",
        "media": ["uploads/hot_fudge_brownie.png"],
        "price_variants": [{"label": "Portion", "price": 275}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-jamun",
        "category_id": "cat-desserts",
        "name": "Gulab Jamun (2pcs)",
        "description": "Traditional deep-fried chenna dumplings soaked in a warm rose-cardamom sugar syrup.",
        "tags": ["Veg"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Portion", "price": 125}],
        "display_order": 2,
        "status": "Published"
      },

      # DRINKS: Fresh Beer (Draught)
      {
        "id": "item-beer-german",
        "category_id": "cat-fresh-beer",
        "name": "South German Wheat Beer",
        "description": "A timeless German wheat beer with a hazy golden body, offering vibrant notes of banana, cloves, and a smooth refreshing finish.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": ["uploads/wheat_beer.png"],
        "price_variants": [
          {"label": "Mug (500ml)", "price": 425},
          {"label": "Pitcher (1.5L)", "price": 1175},
          {"label": "Dispenser (3L)", "price": 2475}
        ],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-beer-wit",
        "category_id": "cat-fresh-beer",
        "name": "Belgian Wit",
        "description": "Light and zesty, this Belgian-style wheat beer is brewed with orange peel and coriander, offering a citrusy, spiced flavour.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": ["uploads/pouring_beer.mp4"],
        "price_variants": [
          {"label": "Mug (500ml)", "price": 425},
          {"label": "Pitcher (1.5L)", "price": 1175},
          {"label": "Dispenser (3L)", "price": 2475}
        ],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-beer-dark",
        "category_id": "cat-fresh-beer",
        "name": "Belgian Dark Strong Ale",
        "description": "A rich, full-bodied beer with deep malt sweetness, notes of dark fruit, caramel, and a hint of warming spice.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Mug (500ml)", "price": 425},
          {"label": "Pitcher (1.5L)", "price": 1175},
          {"label": "Dispenser (3L)", "price": 2475}
        ],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-beer-ipa",
        "category_id": "cat-fresh-beer",
        "name": "West Coast IPA",
        "description": "Bold and hoppy with a crisp bitterness, this IPA is packed with pine, citrus, and tropical fruit flavors, balanced by a dry finish.",
        "tags": ["Alcoholic", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Mug (500ml)", "price": 425},
          {"label": "Pitcher (1.5L)", "price": 1175},
          {"label": "Dispenser (3L)", "price": 2475}
        ],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-beer-blonde",
        "category_id": "cat-fresh-beer",
        "name": "Blonde Lager",
        "description": "A light, refreshing lager brewed with rice for a clean, crisp profile, featuring subtle grain sweetness and a smooth finish.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Mug (500ml)", "price": 425},
          {"label": "Pitcher (1.5L)", "price": 1175},
          {"label": "Dispenser (3L)", "price": 2475}
        ],
        "display_order": 5,
        "status": "Published"
      },

      # DRINKS: Chilled Bottled Beer
      {
        "id": "item-bottle-ultra",
        "category_id": "cat-bottled-beer",
        "name": "Kingfisher Ultra",
        "description": "Crisp and premium local lager.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Pint", "price": 475},
          {"label": "Bucket (5 Pints)", "price": 2075}
        ],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-bottle-tuborg",
        "category_id": "cat-bottled-beer",
        "name": "Tuborg Premium",
        "description": "Chilled Danish lager malt recipe.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Pint", "price": 475},
          {"label": "Bucket (5 Pints)", "price": 2075}
        ],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-bottle-carlsberg",
        "category_id": "cat-bottled-beer",
        "name": "Carlsberg Smooth",
        "description": "Clean hops extract smooth profile lager.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Pint", "price": 475},
          {"label": "Bucket (5 Pints)", "price": 2075}
        ],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-bottle-budweiser",
        "category_id": "cat-bottled-beer",
        "name": "Budweiser",
        "description": "The classic American beechwood-aged king of beers.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Pint", "price": 475},
          {"label": "Bucket (5 Pints)", "price": 2075}
        ],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-bottle-corona",
        "category_id": "cat-bottled-beer",
        "name": "Corona Extra",
        "description": "Smooth Mexican pale lager served with a fresh lime wedge.",
        "tags": ["Alcoholic", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Pint", "price": 645},
          {"label": "Bucket (5 Pints)", "price": 2775}
        ],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-bottle-hoegaarden",
        "category_id": "cat-bottled-beer",
        "name": "Hoegaarden",
        "description": "Imported Belgian wit draught bottled.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "Pint", "price": 645},
          {"label": "Bucket (5 Pints)", "price": 2775}
        ],
        "display_order": 6,
        "status": "Published"
      },

      # DRINKS: Luka Signature Cocktails
      {
        "id": "item-sig-castro",
        "category_id": "cat-sig-cocktails",
        "name": "Cuban Castro",
        "description": "Ingredients: Bacardi, lemongrass, star anise, lime juice.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-sig-berry",
        "category_id": "cat-sig-cocktails",
        "name": "Himalayan Berry",
        "description": "Ingredients: Bacardi, mulberry reduction, burash, lime juice, mint leaves.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-sig-theone",
        "category_id": "cat-sig-cocktails",
        "name": "The One",
        "description": "Ingredients: Bacardi, vodka, fresh jalapenos, pineapple chunks, Tabasco, passion fruit syrup.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-sig-wick",
        "category_id": "cat-sig-cocktails",
        "name": "John Wick",
        "description": "Ingredients: Gin, five spices, Earl Grey tea, lime juice, dash of oak smoke.",
        "tags": ["Alcoholic", "Signature", "Bestseller"],
        "availability": "Available",
        "media": ["uploads/john_wick_cocktail.png"],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-sig-dragon",
        "category_id": "cat-sig-cocktails",
        "name": "Dragon Fire",
        "description": "Ingredients: Gin, basil leaves, kaffir lime, orange juice splash, Angostura bitter float, sour mix.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-sig-summer69",
        "category_id": "cat-sig-cocktails",
        "name": "Summer of 69",
        "description": "Ingredients: Gin, watermelon chunks, basil leaves, watermelon syrup, lime juice.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-sig-firefly",
        "category_id": "cat-sig-cocktails",
        "name": "Fire Fly",
        "description": "Ingredients: Absinthe, gin, orange juice splash, sweet grenadine float.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 7,
        "status": "Published"
      },
      {
        "id": "item-sig-gtown",
        "category_id": "cat-sig-cocktails",
        "name": "G-Town Special",
        "description": "Ingredients: Gin, silver tequila, paan syrup, dry coconut shavings, gulkand, rose water, fresh betel leaf, milk base.",
        "tags": ["Alcoholic", "Signature", "Spicy"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 8,
        "status": "Published"
      },
      {
        "id": "item-sig-malgudi",
        "category_id": "cat-sig-cocktails",
        "name": "Malgudi Days",
        "description": "Ingredients: Vodka, tequila, sweet jamun syrup, black salt, chaat masala, lime, sour mix.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 9,
        "status": "Published"
      },
      {
        "id": "item-sig-kissrose",
        "category_id": "cat-sig-cocktails",
        "name": "Kiss of Rose",
        "description": "Ingredients: Vodka, fresh betel leaf extract, organic rose petals, lime juice, Rooh Afza syrup.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 10,
        "status": "Published"
      },
      {
        "id": "item-sig-high",
        "category_id": "cat-sig-cocktails",
        "name": "High",
        "description": "Ingredients: Gin, tequila, tamarind syrup, Margarita mix, Tabasco dash, togarashi dust.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 11,
        "status": "Published"
      },
      {
        "id": "item-sig-poet",
        "category_id": "cat-sig-cocktails",
        "name": "Poet's Dream",
        "description": "Ingredients: Gin, margarita mix, pineapple juice, blue butterfly pea tea layer, served with caramel popcorn.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 12,
        "status": "Published"
      },
      {
        "id": "item-sig-mountain",
        "category_id": "cat-sig-cocktails",
        "name": "Mountain Breeze",
        "description": "Ingredients: Tequila, Himalayan wild plum reduction, pink kombucha.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 13,
        "status": "Published"
      },
      {
        "id": "item-sig-godfather",
        "category_id": "cat-sig-cocktails",
        "name": "God Father",
        "description": "Ingredients: Bourbon whiskey, Campari reduction.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 14,
        "status": "Published"
      },
      {
        "id": "item-sig-meadow",
        "category_id": "cat-sig-cocktails",
        "name": "Meadow Wine",
        "description": "Ingredients: Red wine, brandy, 5 spices cordial (cinnamon, cloves, star anise).",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 15,
        "status": "Published"
      },
      {
        "id": "item-sig-milkyway",
        "category_id": "cat-sig-cocktails",
        "name": "Milky Way",
        "description": "Ingredients: Kahlua, Baileys, Vodka, coconut milk, dark chocolate, coffee powder, chocolate waffle garnish.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 16,
        "status": "Published"
      },
      {
        "id": "item-sig-summerpopper",
        "category_id": "cat-sig-cocktails",
        "name": "Summer Popper",
        "description": "Ingredients: Infused orange candy vodka, lime juice, splash of orange juice.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 17,
        "status": "Published"
      },
      {
        "id": "item-sig-londonpot",
        "category_id": "cat-sig-cocktails",
        "name": "London Pot",
        "description": "Ingredients: Vodka, elderflower cordial, fresh lime juice, orange juice, club soda.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 18,
        "status": "Published"
      },

      # DRINKS: Classic Cocktails
      {
        "id": "item-classic-mojito",
        "category_id": "cat-classic-cocktails",
        "name": "Classic Mojito",
        "description": "Ingredients: Bacardi white rum, muddled lime wedges, fresh mint leaves, brown sugar, club soda.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-classic-colada",
        "category_id": "cat-classic-cocktails",
        "name": "Pina Colada",
        "description": "Ingredients: Bacardi, pineapple juice, coconut syrup.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-classic-daiquiri",
        "category_id": "cat-classic-cocktails",
        "name": "Daiquiri (Lime/Mango/Strawberry)",
        "description": "Ingredients: Bacardi white rum, fresh fruit puree, sweet & sour reduction.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-classic-cosmo",
        "category_id": "cat-classic-cocktails",
        "name": "Cosmopolitan",
        "description": "Ingredients: Vodka, cranberry juice, triple sec, lime juice.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-classic-sexbeach",
        "category_id": "cat-classic-cocktails",
        "name": "Sex On The Beach",
        "description": "Ingredients: Vodka, peach liqueur, orange juice, cranberry juice.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-classic-caipiroska",
        "category_id": "cat-classic-cocktails",
        "name": "Caipiroska",
        "description": "Ingredients: Vodka, lemon chunks, brown sugar, sweet & sour mix.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-classic-whiskey-sour",
        "category_id": "cat-classic-cocktails",
        "name": "Whiskey Sour",
        "description": "Ingredients: Jim Beam bourbon, pasteurized egg white, sweet & sour mix, Angostura bitter float.",
        "tags": ["Alcoholic", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 7,
        "status": "Published"
      },
      {
        "id": "item-classic-oldfashioned",
        "category_id": "cat-classic-cocktails",
        "name": "Old Fashioned",
        "description": "Ingredients: Jim Beam, Angostura aromatic bitters, brown sugar cube, orange peel twist.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 8,
        "status": "Published"
      },
      {
        "id": "item-classic-manhattan",
        "category_id": "cat-classic-cocktails",
        "name": "Manhattan",
        "description": "Ingredients: Jim Beam, sweet vermouth, angostura bitters, maraschino cherry garnish.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 9,
        "status": "Published"
      },
      {
        "id": "item-classic-lynchburg",
        "category_id": "cat-classic-cocktails",
        "name": "Lynchburg Lemonade",
        "description": "Ingredients: Jack Daniel's Tennessee whiskey, triple sec, sweet & sour mix, splash of sprite.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 10,
        "status": "Published"
      },
      {
        "id": "item-classic-julep",
        "category_id": "cat-classic-cocktails",
        "name": "Mint Julep",
        "description": "Ingredients: Bourbon whiskey, muddled fresh mint, powdered sugar.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 11,
        "status": "Published"
      },
      {
        "id": "item-classic-martini",
        "category_id": "cat-classic-cocktails",
        "name": "Dry Martini",
        "description": "Ingredients: London dry gin, dry vermouth, green olives garnish.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 12,
        "status": "Published"
      },
      {
        "id": "item-classic-negroni",
        "category_id": "cat-classic-cocktails",
        "name": "Negroni",
        "description": "Ingredients: Gin, Campari, sweet red vermouth.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 13,
        "status": "Published"
      },
      {
        "id": "item-classic-margarita",
        "category_id": "cat-classic-cocktails",
        "name": "Margarita",
        "description": "Ingredients: Silver tequila, triple sec, sweet & sour lime mix, salt-rimmed glass.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 475}],
        "display_order": 14,
        "status": "Published"
      },
      {
        "id": "item-classic-sangria",
        "category_id": "cat-classic-cocktails",
        "name": "Classic Sangria (Red/White)",
        "description": "Ingredients: Spanish wine base infused with apples, oranges, seasonal fruits, splash of brandy.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 15,
        "status": "Published"
      },
      {
        "id": "item-classic-hottoddy",
        "category_id": "cat-classic-cocktails",
        "name": "Hot Toddy",
        "description": "Ingredients: Bourbon whiskey, organic honey, lime juice, cinnamon stick, star anise, hot water.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 575}],
        "display_order": 16,
        "status": "Published"
      },

      # DRINKS: Shooters
      {
        "id": "item-shoot-kamikaze",
        "category_id": "cat-shooters",
        "name": "Kamikaze Shot",
        "description": "Ingredients: Vodka, triple sec, lime juice.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 425},
          {"label": "5 Shots", "price": 1675}
        ],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-shoot-jdfire",
        "category_id": "cat-shooters",
        "name": "Jack Daniel's Fire",
        "description": "Cinnamon infused Tennessee whiskey shooter.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 525},
          {"label": "5 Shots", "price": 1975}
        ],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-shoot-duckfart",
        "category_id": "cat-shooters",
        "name": "Duck Fart",
        "description": "Layered shooter with Kahlua, Baileys, and Whiskey.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 575},
          {"label": "5 Shots", "price": 2375}
        ],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-shoot-horneybull",
        "category_id": "cat-shooters",
        "name": "Horney Bull",
        "description": "Layered shooter with silver Tequila, Kahlua, Jagermeister.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 575},
          {"label": "5 Shots", "price": 2375}
        ],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-shoot-bmw",
        "category_id": "cat-shooters",
        "name": "BMW",
        "description": "Layered shooter with Baileys Irish cream, Malibu coconut rum, and Whiskey.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 575},
          {"label": "5 Shots", "price": 2375}
        ],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-shoot-powerslide",
        "category_id": "cat-shooters",
        "name": "Power Slide",
        "description": "Layered shooter with Kahlua coffee liqueur, Baileys, and Jagermeister.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 575},
          {"label": "5 Shots", "price": 2375}
        ],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-shoot-b52",
        "category_id": "cat-shooters",
        "name": "B-52",
        "description": "Layered shooter with Kahlua, Baileys, and Triple Sec.",
        "tags": ["Alcoholic", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 575},
          {"label": "5 Shots", "price": 2375}
        ],
        "display_order": 7,
        "status": "Published"
      },
      {
        "id": "item-shoot-brain",
        "category_id": "cat-shooters",
        "name": "Brain Hemorrhage",
        "description": "Visual shooter with peach schnapps, Baileys float, and drops of red grenadine.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 575},
          {"label": "5 Shots", "price": 2375}
        ],
        "display_order": 8,
        "status": "Published"
      },
      {
        "id": "item-shoot-jagerbomb",
        "category_id": "cat-shooters",
        "name": "Jager Bomb",
        "description": "Ingredients: Jagermeister shot dropped into a glass of energy drink.",
        "tags": ["Alcoholic", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "1 Shot", "price": 625},
          {"label": "5 Shots", "price": 2475}
        ],
        "display_order": 9,
        "status": "Published"
      },

      # DRINKS: Tequilas
      {
        "id": "item-teq-caminosilver",
        "category_id": "cat-tequilas",
        "name": "Camino Silver",
        "description": "Clear silver tequila, Jalisco, Mexico.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 435},
          {"label": "Buy 4 Get 5", "price": 1735}
        ],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-teq-pablinasilver",
        "category_id": "cat-tequilas",
        "name": "Pablina Silver",
        "description": "Clear premium Mexican white tequila.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 435},
          {"label": "Buy 4 Get 5", "price": 1735}
        ],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-teq-cascosilver",
        "category_id": "cat-tequilas",
        "name": "Casco Viejo Silver",
        "description": "100% blue agave silver tequila.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 435},
          {"label": "Buy 4 Get 5", "price": 1735}
        ],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-teq-caminogold",
        "category_id": "cat-tequilas",
        "name": "Camino Gold",
        "description": "Gold amber reposado tequila.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 465},
          {"label": "Buy 4 Get 5", "price": 1855}
        ],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-teq-pablinagold",
        "category_id": "cat-tequilas",
        "name": "Pablina Gold",
        "description": "Premium gold-block reposado tequila.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 465},
          {"label": "Buy 4 Get 5", "price": 1855}
        ],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-teq-cascogold",
        "category_id": "cat-tequilas",
        "name": "Casco Viejo Gold",
        "description": "Gold oak aged reposado tequila.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 465},
          {"label": "Buy 4 Get 5", "price": 1855}
        ],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-teq-patronsilver",
        "category_id": "cat-tequilas",
        "name": "Patron Silver",
        "description": "Ultra-premium 100% blue agave silver tequila.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 875},
          {"label": "Buy 4 Get 5", "price": 3500}
        ],
        "display_order": 7,
        "status": "Published"
      },
      {
        "id": "item-teq-patronrepo",
        "category_id": "cat-tequilas",
        "name": "Patron Reposado",
        "description": "Ultra-premium barrel aged smooth reposado tequila.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [
          {"label": "30 ML Peg", "price": 875},
          {"label": "Buy 4 Get 5", "price": 3500}
        ],
        "display_order": 8,
        "status": "Published"
      },

      # DRINKS: Liqueurs
      {
        "id": "item-liq-baileys",
        "category_id": "cat-liqueurs",
        "name": "Baileys Irish Cream",
        "description": "Cream and whiskey based liqueur.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 375}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-liq-sambuca",
        "category_id": "cat-liqueurs",
        "name": "Sambuca",
        "description": "Anise flavored Italian clear digestif.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 375}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-liq-jdapple",
        "category_id": "cat-liqueurs",
        "name": "Jack Daniel's Apple",
        "description": "Green apple liqueur blended with JD whiskey.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 375}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-liq-kahlua",
        "category_id": "cat-liqueurs",
        "name": "Kahlua",
        "description": "Coffee liqueur from Veracruz, Mexico.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 375}],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-liq-cointreau",
        "category_id": "cat-liqueurs",
        "name": "Cointreau",
        "description": "Premium French orange triple sec liqueur.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 375}],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-liq-jager",
        "category_id": "cat-liqueurs",
        "name": "Jagermeister",
        "description": "German herbal liqueur made with 56 herbs.",
        "tags": ["Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 375}],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-liq-absinthe",
        "category_id": "cat-liqueurs",
        "name": "Absinthe (47% Vol)",
        "description": "Anise flavored high proof green wormwood spirit.",
        "tags": ["Alcoholic", "Signature"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "30 ML Peg", "price": 575}],
        "display_order": 7,
        "status": "Published"
      },

      # DRINKS: Mocktails
      {
        "id": "item-mock-mango",
        "category_id": "cat-mocktails",
        "name": "Mango Mint Rapture",
        "description": "Blended concoction of ripe mango nectar and fresh mint leaves.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-mock-bluehawaiian",
        "category_id": "cat-mocktails",
        "name": "Blue Hawaiian Mocktail",
        "description": "Fruity concoction of pineapple juice, coconut syrup, blue curacao.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-mock-kiwi",
        "category_id": "cat-mocktails",
        "name": "Kiwi Cooler",
        "description": "Classic blend of fresh kiwi pulp and coconut milk.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-mock-watermelon",
        "category_id": "cat-mocktails",
        "name": "Watermelon Mint Virgin Mojito",
        "description": "Fresh watermelon chunks, mint leaves, lime juice, watermelon syrup, club soda.",
        "tags": ["Non-Alcoholic", "Bestseller"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-mock-guava",
        "category_id": "cat-mocktails",
        "name": "Guava Mary",
        "description": "Guava juice, fresh lime juice, black rock salt, tabasco drops, chaat masala rim.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-mock-fruitpunch",
        "category_id": "cat-mocktails",
        "name": "Luka Fruit Punch",
        "description": "Orange juice, pineapple juice, cranberry juice, fresh strawberry crush, vanilla ice cream float.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-mock-virginmojito",
        "category_id": "cat-mocktails",
        "name": "Virgin Mojito",
        "description": "Classic virgin mojito with lime wedges, sugar syrup, fresh mint, soda.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 7,
        "status": "Published"
      },
      {
        "id": "item-mock-colada",
        "category_id": "cat-mocktails",
        "name": "Pineapple Colada",
        "description": "Pineapple chunks, fresh pineapple juice, coconut milk syrup, whipped cream.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 8,
        "status": "Published"
      },

      # DRINKS: Non-Alcoholic Beverages
      {
        "id": "item-bev-soda",
        "category_id": "cat-beverages",
        "name": "Carbonated Soda Water",
        "description": "Chilled bubbly club soda.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 75}],
        "display_order": 1,
        "status": "Published"
      },
      {
        "id": "item-bev-juice",
        "category_id": "cat-beverages",
        "name": "Packaged Fruit Juice",
        "description": "Cranberry / Mango / Pineapple juice selection.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 175}],
        "display_order": 2,
        "status": "Published"
      },
      {
        "id": "item-bev-vedica",
        "category_id": "cat-beverages",
        "name": "Vedica Mineral Water",
        "description": "Premium spring mineral water bottle.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Bottle", "price": 125}],
        "display_order": 3,
        "status": "Published"
      },
      {
        "id": "item-bev-limesoda",
        "category_id": "cat-beverages",
        "name": "Fresh Lime Soda/Water",
        "description": "Freshly squeezed lime with soda. Served Sweet, Salted or Mixed.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 175}],
        "display_order": 4,
        "status": "Published"
      },
      {
        "id": "item-bev-coke",
        "category_id": "cat-beverages",
        "name": "Coke / Sprite",
        "description": "Chilled carbonated soft drinks.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 155}],
        "display_order": 5,
        "status": "Published"
      },
      {
        "id": "item-bev-dietcoke",
        "category_id": "cat-beverages",
        "name": "Diet Coke",
        "description": "Sugar-free carbonated cola.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 175}],
        "display_order": 6,
        "status": "Published"
      },
      {
        "id": "item-bev-gingerale",
        "category_id": "cat-beverages",
        "name": "Ginger Ale",
        "description": "Chilled carbonated ginger ale mixer.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 175}],
        "display_order": 7,
        "status": "Published"
      },
      {
        "id": "item-bev-tonic",
        "category_id": "cat-beverages",
        "name": "Tonic Water",
        "description": "Carbonated tonic water.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 175}],
        "display_order": 8,
        "status": "Published"
      },
      {
        "id": "item-bev-masalacola",
        "category_id": "cat-beverages",
        "name": "Masala Cola",
        "description": "Coke spiced with cumin, black salt, and lemon juice.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 9,
        "status": "Published"
      },
      {
        "id": "item-bev-icedtea",
        "category_id": "cat-beverages",
        "name": "Iced Tea (Peach/Lemon)",
        "description": "Chilled brewed black tea with fruit infusions.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 10,
        "status": "Published"
      },
      {
        "id": "item-bev-lemonade",
        "category_id": "cat-beverages",
        "name": "Masala Lemonade",
        "description": "Shaken fresh lemonade with chaat masala spice.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Glass", "price": 275}],
        "display_order": 11,
        "status": "Published"
      },
      {
        "id": "item-bev-redbull",
        "category_id": "cat-beverages",
        "name": "Red Bull Energy Drink",
        "description": "Energy drink.",
        "tags": ["Non-Alcoholic"],
        "availability": "Available",
        "media": [],
        "price_variants": [{"label": "Can", "price": 325}],
        "display_order": 12,
        "status": "Published"
      }
    ]

    payload = {"categories": categories, "items": items}
    with open(filepath, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"[SERVER] Seeded complete menu database: {len(items)} items in {len(categories)} categories.")

class DowntownLukaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path == "/api/menu":
            self.handle_get_menu()
        elif self.path == "/api/audit-log":
            self.handle_get_audit_log()
        elif self.path == "/api/users":
            self.handle_get_users()
        elif self.path.startswith("/api/orders"):
            self.handle_get_orders()
        elif self.path == "/api/invoices":
            self.handle_get_invoices()
        elif self.path.startswith("/api/invoice"):
            self.handle_get_single_invoice()
        # Kitchen Display API
        elif self.path == "/api/kitchen/orders":
            self.handle_kitchen_orders()
        elif self.path == "/api/kitchen/stats":
            self.handle_kitchen_stats()
        # Dashboard Analytics API
        elif self.path == "/api/dashboard/summary":
            self.handle_dashboard_summary()
        elif self.path == "/api/dashboard/revenue":
            self.handle_dashboard_revenue()
        elif self.path == "/api/dashboard/items":
            self.handle_dashboard_items()
        elif self.path == "/api/dashboard/categories":
            self.handle_dashboard_categories()
        elif self.path == "/api/dashboard/hourly":
            self.handle_dashboard_hourly()
        else:
            # Fallback to serving static html files
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/menu":
            self.handle_save_menu()
        elif self.path == "/api/upload":
            self.handle_media_upload()
        elif self.path == "/api/login":
            self.handle_login()
        elif self.path == "/api/users":
            self.handle_save_users()
        elif self.path == "/api/orders":
            self.handle_save_order()
        elif self.path == "/api/orders/update-status":
            self.handle_update_order_status()
        elif self.path == "/api/orders/checkout":
            self.handle_checkout_order()
        elif self.path == "/api/orders/request-checkout":
            self.handle_request_checkout()
        elif self.path == "/api/kitchen/update-status":
            self.handle_kitchen_update_status()
        elif self.path == "/api/log-error":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                err_data = json.loads(body)
                print("\n================ CLIENT-SIDE ERROR ================")
                print(f"Message: {err_data.get('message')}")
                print(f"Source: {err_data.get('source')} (Line: {err_data.get('lineno')}, Col: {err_data.get('colno')})")
                print(f"Stack Trace:\n{err_data.get('stack')}")
                print("===================================================\n")
                self.send_api_json(200, {"status": "ok"})
            except Exception as e:
                print("Logging error failed:", e)
                self.send_api_json(500, {"status": "error", "message": str(e)})
        else:
            self.send_error(404, "Endpoint not found")

    # ──────────────────────────────────────────────────────────────
    # KITCHEN DISPLAY SYSTEM HANDLERS
    # ──────────────────────────────────────────────────────────────

    def handle_kitchen_orders(self):
        """GET /api/kitchen/orders — Returns all order rounds flattened, sorted oldest first."""
        user = urllib.parse.unquote(self.headers.get("X-Staff-User", "System"))
        role = self._get_role(user)
        if role not in ["Admin", "Owner", "Kitchen"]:
            self.send_api_json(403, {"status": "error", "message": "Kitchen role required."})
            return

        active_orders = {}
        if os.path.exists("active_orders.json"):
            try:
                with open("active_orders.json", "r") as f:
                    active_orders = json.load(f)
            except Exception:
                active_orders = {}

        flat = []
        for table_key, table_data in active_orders.items():
            if not isinstance(table_data, dict):
                continue
            for idx, order in enumerate(table_data.get("orders", [])):
                flat.append({
                    "order_id":      order.get("order_id", ""),
                    "table_no":      table_data.get("table_no", table_key.replace("table_", "")),
                    "customer_name": table_data.get("customer_name", "Guest"),
                    "round":         idx + 1,
                    "timestamp":     order.get("timestamp", ""),
                    "completed_at":  order.get("completed_at", None),
                    "status":        order.get("status", "Received"),
                    "items":         order.get("items", []),
                })

        flat.sort(key=lambda x: x.get("timestamp", ""))
        self.send_api_json(200, flat)

    def handle_kitchen_stats(self):
        """GET /api/kitchen/stats — Returns kitchen summary metrics."""
        user = urllib.parse.unquote(self.headers.get("X-Staff-User", "System"))
        role = self._get_role(user)
        if role not in ["Admin", "Owner", "Kitchen"]:
            self.send_api_json(403, {"status": "error", "message": "Kitchen role required."})
            return

        active_orders = {}
        if os.path.exists("active_orders.json"):
            try:
                with open("active_orders.json", "r") as f:
                    active_orders = json.load(f)
            except Exception:
                active_orders = {}

        all_rounds = []
        for td in active_orders.values():
            if isinstance(td, dict):
                all_rounds.extend(td.get("orders", []))

        import datetime
        now = datetime.datetime.utcnow()

        received  = sum(1 for o in all_rounds if o.get("status") == "Received")
        preparing = sum(1 for o in all_rounds if o.get("status") == "Preparing")
        ready     = sum(1 for o in all_rounds if o.get("status") == "Ready")
        served    = sum(1 for o in all_rounds if o.get("status") == "Served")

        # Longest pending (minutes)
        pending = [o for o in all_rounds if o.get("status") not in ["Served"]]
        longest_min = 0
        for o in pending:
            try:
                ts = datetime.datetime.fromisoformat(o["timestamp"].replace("Z", "+00:00")).replace(tzinfo=None)
                diff = (now - ts).total_seconds() / 60
                longest_min = max(longest_min, diff)
            except Exception:
                pass

        self.send_api_json(200, {
            "received":    received,
            "preparing":   preparing,
            "ready":       ready,
            "served":      served,
            "longest_min": round(longest_min, 1),
        })

    def handle_kitchen_update_status(self):
        """POST /api/kitchen/update-status — Updates order round status."""
        user = urllib.parse.unquote(self.headers.get("X-Staff-User", "System"))
        role = self._get_role(user)
        if role not in ["Admin", "Kitchen"]:
            self.send_api_json(403, {"status": "error", "message": "Kitchen role required."})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length).decode("utf-8"))
            order_id  = body.get("order_id", "")
            table_no  = str(body.get("table_no", ""))
            new_status = body.get("status", "")
            valid_statuses = ["Received", "Preparing", "Ready", "Served"]
            if new_status not in valid_statuses:
                self.send_api_json(400, {"status": "error", "message": "Invalid status."})
                return

            active_orders = {}
            if os.path.exists("active_orders.json"):
                with open("active_orders.json", "r") as f:
                    active_orders = json.load(f)

            table_key = f"table_{table_no}"
            updated = False
            if table_key in active_orders:
                for order in active_orders[table_key].get("orders", []):
                    if order.get("order_id") == order_id:
                        order["status"] = new_status
                        if new_status == "Served":
                            import datetime
                            order["completed_at"] = datetime.datetime.utcnow().isoformat() + "Z"
                        updated = True
                        break

            if not updated:
                self.send_api_json(404, {"status": "error", "message": "Order not found."})
                return

            with open("active_orders.json", "w") as f:
                json.dump(active_orders, f, indent=2)

            self._write_audit_log(user, f"Kitchen updated order {order_id} (Table {table_no}) → {new_status}")
            self.send_api_json(200, {"status": "ok", "message": f"Status updated to {new_status}"})
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": str(e)})

    # ──────────────────────────────────────────────────────────────
    # ANALYTICS DASHBOARD HANDLERS
    # ──────────────────────────────────────────────────────────────

    def _load_invoices(self):
        if os.path.exists("invoices.json"):
            try:
                with open("invoices.json", "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _get_role(self, username):
        if os.path.exists("users.json"):
            try:
                with open("users.json", "r") as f:
                    db = json.load(f)
                profile = db.get(username.lower())
                if isinstance(profile, dict):
                    return profile.get("role", "Staff")
            except Exception:
                pass
        return "Staff"

    def _require_dashboard_role(self):
        user = urllib.parse.unquote(self.headers.get("X-Staff-User", "System"))
        role = self._get_role(user)
        if role not in ["Admin", "Owner"]:
            self.send_api_json(403, {"status": "error", "message": "Admin or Owner role required."})
            return False
        return True

    def handle_dashboard_summary(self):
        """GET /api/dashboard/summary"""
        if not self._require_dashboard_role():
            return
        import datetime
        invoices = self._load_invoices()
        today_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")

        today_inv = [i for i in invoices if i.get("timestamp", "").startswith(today_str)]
        today_revenue = sum(i.get("total", 0) for i in today_inv)

        # Monthly revenue (last 30 days)
        cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=30)
        monthly_inv = [i for i in invoices if datetime.datetime.fromisoformat(
            i.get("timestamp", "2000-01-01T00:00:00Z").replace("Z", "+00:00")
        ).replace(tzinfo=None) >= cutoff]
        monthly_revenue = sum(i.get("total", 0) for i in monthly_inv)

        avg_bill = (sum(i.get("total", 0) for i in invoices) / len(invoices)) if invoices else 0

        # Active tables
        active_tables = 0
        if os.path.exists("active_orders.json"):
            try:
                with open("active_orders.json", "r") as f:
                    ao = json.load(f)
                active_tables = len(ao)
            except Exception:
                pass

        # Pending orders
        pending = 0
        if os.path.exists("active_orders.json"):
            try:
                with open("active_orders.json", "r") as f:
                    ao = json.load(f)
                for td in ao.values():
                    if isinstance(td, dict):
                        for o in td.get("orders", []):
                            if o.get("status") in ["Received", "Preparing"]:
                                pending += 1
            except Exception:
                pass

        self.send_api_json(200, {
            "today_revenue":   round(today_revenue, 2),
            "today_invoices":  len(today_inv),
            "active_tables":   active_tables,
            "avg_bill":        round(avg_bill, 2),
            "monthly_revenue": round(monthly_revenue, 2),
            "pending_orders":  pending,
        })

    def handle_dashboard_revenue(self):
        """GET /api/dashboard/revenue — Last 30 days daily revenue"""
        if not self._require_dashboard_role():
            return
        import datetime
        invoices = self._load_invoices()
        today = datetime.datetime.utcnow().date()
        result = []
        for i in range(29, -1, -1):
            day = today - datetime.timedelta(days=i)
            day_str = day.strftime("%Y-%m-%d")
            rev = sum(inv.get("total", 0) for inv in invoices if inv.get("timestamp", "").startswith(day_str))
            result.append({"date": day.strftime("%d %b"), "revenue": round(rev, 2)})
        self.send_api_json(200, result)

    def handle_dashboard_items(self):
        """GET /api/dashboard/items — Top selling items"""
        if not self._require_dashboard_role():
            return
        invoices = self._load_invoices()
        item_map = {}
        for inv in invoices:
            for item in inv.get("items", []):
                name = item.get("name", "Unknown")
                qty  = item.get("quantity", 1)
                price = item.get("price", 0)
                if name not in item_map:
                    item_map[name] = {"name": name, "qty": 0, "revenue": 0}
                item_map[name]["qty"]     += qty
                item_map[name]["revenue"] += qty * price
        ranked = sorted(item_map.values(), key=lambda x: x["qty"], reverse=True)[:20]
        self.send_api_json(200, ranked)

    def handle_dashboard_categories(self):
        """GET /api/dashboard/categories — Revenue by category"""
        if not self._require_dashboard_role():
            return
        invoices = self._load_invoices()
        # Load menu to get category mapping
        menu_items = {}
        if os.path.exists("menu_data.json"):
            try:
                with open("menu_data.json", "r") as f:
                    md = json.load(f)
                categories = {c["id"]: c["name"] for c in md.get("categories", [])}
                for item in md.get("items", []):
                    cat_id   = item.get("category_id", "")
                    cat_name = categories.get(cat_id, "Other")
                    menu_items[item["name"]] = cat_name
            except Exception:
                pass

        cat_map = {}
        for inv in invoices:
            for item in inv.get("items", []):
                name     = item.get("name", "")
                cat      = menu_items.get(name, "Other")
                revenue  = item.get("price", 0) * item.get("quantity", 1)
                cat_map[cat] = cat_map.get(cat, 0) + revenue

        result = [{"category": k, "revenue": round(v, 2)} for k, v in sorted(cat_map.items(), key=lambda x: -x[1])]
        self.send_api_json(200, result)

    def handle_dashboard_hourly(self):
        """GET /api/dashboard/hourly — Peak hours analysis"""
        if not self._require_dashboard_role():
            return
        invoices = self._load_invoices()
        import datetime
        hour_map = {h: 0 for h in range(24)}
        for inv in invoices:
            try:
                ts = datetime.datetime.fromisoformat(inv.get("timestamp", "").replace("Z", "+00:00"))
                # Convert UTC to IST (UTC+5:30)
                ist = ts.replace(tzinfo=None) + datetime.timedelta(hours=5, minutes=30)
                hour_map[ist.hour] += 1
            except Exception:
                pass
        result = [
            {"hour": f"{h:02d}:00", "orders": hour_map[h]}
            for h in range(10, 24)  # Show 10am to midnight
        ]
        self.send_api_json(200, result)

    def handle_login(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            credentials = json.loads(body)
            
            username = credentials.get("username", "").strip()
            password = credentials.get("password", "").strip()
            
            filepath = "users.json"
            if not os.path.exists(filepath):
                with open(filepath, "w") as f:
                    json.dump({"admin": {"password": "admin123", "role": "Admin"}}, f, indent=2)
            
            with open(filepath, "r") as f:
                users_db = json.load(f)
            
            matched_pass = None
            role = "Staff"
            for u, profile in users_db.items():
                if u.lower() == username.lower():
                    if isinstance(profile, dict):
                        matched_pass = profile.get("password")
                        role = profile.get("role", "Staff")
                    else:
                        matched_pass = profile
                        role = "Staff"
                    break
            
            if matched_pass and str(matched_pass) == password:
                self.send_api_json(200, {"status": "success", "username": username, "role": role})
            else:
                self.send_api_json(401, {"status": "error", "message": "Invalid username or password"})
        except Exception as e:
            print(f"[LOGIN ERROR] Exception: {e}")
            self.send_api_json(500, {"status": "error", "message": f"Internal login server error: {e}"})

    def handle_get_menu(self):
        filepath = "menu_data.json"
        if not os.path.exists(filepath):
            initialize_seed_data()
        
        try:
            with open(filepath, "r") as f:
                data = json.load(f)
            self.send_api_json(200, data)
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": f"Failed to read data: {e}"})

    def handle_save_menu(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)
            
            # Simple check
            if "categories" not in data or "items" not in data:
                self.send_api_json(400, {"status": "error", "message": "Invalid menu data format"})
                return

            # Parse headers for audit logging
            user = self.headers.get("X-Staff-User", "System")
            action = self.headers.get("X-Audit-Action", "Modified Menu Catalog")
            user = urllib.parse.unquote(user)
            action = urllib.parse.unquote(action)

            # Look up role in users.json
            role = "Staff"
            if os.path.exists("users.json"):
                try:
                    with open("users.json", "r") as f:
                        users_db = json.load(f)
                    profile = users_db.get(user.lower())
                    if isinstance(profile, dict):
                        role = profile.get("role", "Staff")
                except Exception:
                    role = "Staff"

            # Retrieve old menu state
            old_data = {"categories": [], "items": []}
            old_filepath = "menu_data.json"
            if os.path.exists(old_filepath):
                try:
                    with open(old_filepath, "r") as f:
                        old_data = json.load(f)
                except Exception:
                    pass

            old_items = old_data.get("items", [])
            new_items = data.get("items", [])
            old_cats = old_data.get("categories", [])
            new_cats = data.get("categories", [])

            # 1. Waiter permission validation
            if role == "Waiter":
                # Waiter can ONLY change stock availability.
                if len(old_items) != len(new_items) or len(old_cats) != len(new_cats) or json.dumps(old_cats) != json.dumps(new_cats):
                    self.send_api_json(403, {"status": "error", "message": "Permission Denied: Waiters can only modify stock availability. Cannot add/delete items or categories."})
                    return
                
                old_items_dict = {i["id"]: i for i in old_items}
                for n_item in new_items:
                    o_item = old_items_dict.get(n_item["id"])
                    if not o_item:
                        self.send_api_json(403, {"status": "error", "message": "Permission Denied: Waiter cannot create items."})
                        return
                    
                    # Ensure no field other than availability has changed
                    for key in n_item.keys():
                        if key != "availability" and json.dumps(o_item.get(key)) != json.dumps(n_item.get(key)):
                            self.send_api_json(403, {"status": "error", "message": f"Permission Denied: Waiters can only modify stock availability. Field '{key}' is locked."})
                            return

            # 2. Receptionist permission validation
            elif role == "Receptionist":
                # Receptionist can add items, change prices, change serving sizes, edit descriptions/names/categories.
                # Receptionist cannot delete items, and cannot modify categories list structure.
                if len(old_cats) != len(new_cats) or json.dumps(old_cats) != json.dumps(new_cats):
                    self.send_api_json(403, {"status": "error", "message": "Permission Denied: Receptionist role cannot modify categories structure."})
                    return

                # Prevent deletion of menu items (old item IDs must be subset of new item IDs)
                old_ids = {i["id"] for i in old_items}
                new_ids = {i["id"] for i in new_items}
                if not old_ids.issubset(new_ids):
                    self.send_api_json(403, {"status": "error", "message": "Permission Denied: Receptionist role cannot delete menu items."})
                    return

            # 3. Owner permission validation
            elif role == "Owner":
                # Owner can do all things of Waiter & Receptionist (add, edit availability, price, serving size, delete items).
                # But Owner cannot change the categories list structure.
                if len(old_cats) != len(new_cats) or json.dumps(old_cats) != json.dumps(new_cats):
                    self.send_api_json(403, {"status": "error", "message": "Permission Denied: Owner role cannot modify categories list structure."})
                    return

            # Save check passed
            with open("menu_data.json", "w") as f:
                json.dump(data, f, indent=2)
            
            self.log_audit_event(user, action)
            self.send_api_json(200, {"status": "success", "message": "Menu saved successfully"})
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": f"Failed to save data: {e}"})

    def log_audit_event(self, user, action):
        filepath = "audit_log.json"
        logs = []
        if os.path.exists(filepath):
            try:
                with open(filepath, "r") as f:
                    logs = json.load(f)
            except Exception:
                logs = []
        
        new_log = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "user": user,
            "action": action
        }
        logs.append(new_log)
        
        try:
            with open(filepath, "w") as f:
                json.dump(logs, f, indent=2)
        except Exception as e:
            print(f"[AUDIT LOG ERROR] Failed to write log: {e}")

    def handle_get_audit_log(self):
        # Check permissions: Only Owner / Admin can read logs
        user = self.headers.get("X-Staff-User", "System")
        user = urllib.parse.unquote(user)

        role = "Staff"
        if os.path.exists("users.json"):
            try:
                with open("users.json", "r") as f:
                    users_db = json.load(f)
                profile = users_db.get(user.lower())
                if isinstance(profile, dict):
                    role = profile.get("role", "Staff")
            except Exception:
                role = "Staff"

        if role not in ["Admin", "Owner"]:
            self.send_api_json(403, {"status": "error", "message": "Permission Denied: Only Admin or Owner roles can access Audit Logs."})
            return

        filepath = "audit_log.json"
        logs = []
        if os.path.exists(filepath):
            try:
                with open(filepath, "r") as f:
                    logs = json.load(f)
            except Exception:
                logs = []
        # Return sorted newest logs first
        sorted_logs = sorted(logs, key=lambda x: x.get("timestamp", ""), reverse=True)
        self.send_api_json(200, sorted_logs)

    def handle_media_upload(self):
        try:
            content_type = self.headers.get("Content-Type", "")
            if "multipart/form-data" not in content_type:
                self.send_api_json(400, {"status": "error", "message": "Expected multipart form content"})
                return

            boundary = content_type.split("boundary=")[1].encode()
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            parts = body.split(b"--" + boundary)
            file_bytes = None
            filename = "media_item"

            for part in parts:
                if b"filename=" in part:
                    header_end = part.find(b"\r\n\r\n")
                    if header_end != -1:
                        header = part[:header_end].decode("utf-8", errors="ignore")
                        for line in header.split("\r\n"):
                            if "filename=" in line:
                                filename = line.split("filename=")[1].strip('"\'')
                        
                        # Extract exact binary content
                        file_bytes = part[header_end + 4:-2] # remove trailing \r\n
                        break

            if not file_bytes:
                self.send_api_json(400, {"status": "error", "message": "No file content detected"})
                return

            # Sanitize filename
            filename = "".join([c for c in filename if c.isalnum() or c in ".-_"])
            filename = f"{int(time.time())}_{filename}"

            os.makedirs("uploads", exist_ok=True)
            filepath = os.path.join("uploads", filename)
            with open(filepath, "wb") as f:
                f.write(file_bytes)

            # Return file path relative to root
            self.send_api_json(200, {"status": "success", "url": f"/uploads/{filename}"})

        except Exception as e:
            print(f"[UPLOAD ERROR] Exception: {e}")
            self.send_api_json(500, {"status": "error", "message": f"Internal upload error: {e}"})

    def handle_get_users(self):
        # Only Admin can fetch user accounts directory
        user = self.headers.get("X-Staff-User", "System")
        user = urllib.parse.unquote(user)

        role = "Staff"
        if os.path.exists("users.json"):
            try:
                with open("users.json", "r") as f:
                    users_db = json.load(f)
                profile = users_db.get(user.lower())
                if isinstance(profile, dict):
                    role = profile.get("role", "Staff")
            except Exception:
                role = "Staff"

        if role != "Admin":
            self.send_api_json(403, {"status": "error", "message": "Permission Denied: Only Admin can manage users profiles."})
            return

        self.send_api_json(200, users_db)

    def handle_save_users(self):
        # Only Admin can update user accounts directory
        user = self.headers.get("X-Staff-User", "System")
        user = urllib.parse.unquote(user)

        role = "Staff"
        if os.path.exists("users.json"):
            try:
                with open("users.json", "r") as f:
                    users_db = json.load(f)
                profile = users_db.get(user.lower())
                if isinstance(profile, dict):
                    role = profile.get("role", "Staff")
            except Exception:
                role = "Staff"

        if role != "Admin":
            self.send_api_json(403, {"status": "error", "message": "Permission Denied: Only Admin can manage users profiles."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            new_users_db = json.loads(body)

            with open("users.json", "w") as f:
                json.dump(new_users_db, f, indent=2)

            self.log_audit_event(user, "Admin modified user profiles list")
            self.send_api_json(200, {"status": "success", "message": "User profiles saved successfully."})
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": f"Failed to save user profiles: {e}"})

    def handle_get_orders(self):
        filepath = "active_orders.json"
        orders = {}
        if os.path.exists(filepath):
            try:
                with open(filepath, "r") as f:
                    orders = json.load(f)
            except Exception:
                orders = {}
        self.send_api_json(200, orders)

    def handle_save_order(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)

            table_no = str(data.get("table_no", "")).strip()
            customer_name = str(data.get("customer_name", "Guest")).strip()
            customer_phone = str(data.get("customer_phone", "")).strip()
            items_list = data.get("items", [])

            if not table_no or not items_list:
                self.send_api_json(400, {"status": "error", "message": "Missing table number or items list"})
                return

            filepath = "active_orders.json"
            orders = {}
            if os.path.exists(filepath):
                try:
                    with open(filepath, "r") as f:
                        orders = json.load(f)
                except Exception:
                    orders = {}

            table_key = f"table_{table_no}"
            if table_key not in orders:
                orders[table_key] = {
                    "table_no": table_no,
                    "session_id": f"sess_{int(time.time())}",
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "status": "Active",
                    "orders": []
                }

            new_round = {
                "order_id": f"ord_{int(time.time() * 1000)}",
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "status": "Received",
                "items": items_list
            }
            orders[table_key]["orders"].append(new_round)

            with open(filepath, "w") as f:
                json.dump(orders, f, indent=2)

            self.log_audit_event("Customer", f"Placed order round for Table {table_no}")
            self.send_api_json(200, {"status": "success", "message": "Order round placed successfully!", "orders": orders[table_key]})
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": f"Failed to place order: {e}"})

    def handle_update_order_status(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)

            table_no = str(data.get("table_no", "")).strip()
            order_id = data.get("order_id", "")
            new_status = data.get("status", "")

            if not table_no or not order_id or not new_status:
                self.send_api_json(400, {"status": "error", "message": "Missing required fields"})
                return

            filepath = "active_orders.json"
            orders = {}
            if os.path.exists(filepath):
                try:
                    with open(filepath, "r") as f:
                        orders = json.load(f)
                except Exception:
                    pass

            table_key = f"table_{table_no}"
            if table_key in orders:
                for ord_round in orders[table_key].get("orders", []):
                    if ord_round.get("order_id") == order_id:
                        ord_round["status"] = new_status
                        break

                with open(filepath, "w") as f:
                    json.dump(orders, f, indent=2)
                
                staff = self.headers.get("X-Staff-User", "System")
                staff = urllib.parse.unquote(staff)
                self.log_audit_event(staff, f"Updated Table {table_no} order {order_id} status to {new_status}")
                
                self.send_api_json(200, {"status": "success", "message": "Status updated successfully"})
            else:
                self.send_api_json(404, {"status": "error", "message": "Table dining session not found"})
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": f"Failed to update status: {e}"})

    def handle_checkout_order(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)

            table_no = str(data.get("table_no", "")).strip()
            if not table_no:
                self.send_api_json(400, {"status": "error", "message": "Missing table number"})
                return

            staff = self.headers.get("X-Staff-User", "System")
            staff = urllib.parse.unquote(staff)
            
            role = "Staff"
            if os.path.exists("users.json"):
                try:
                    with open("users.json", "r") as f:
                        users_db = json.load(f)
                    profile = users_db.get(staff.lower())
                    if isinstance(profile, dict):
                        role = profile.get("role", "Staff")
                except Exception:
                    pass

            if role == "Waiter":
                self.send_api_json(403, {"status": "error", "message": "Permission Denied: Waiters cannot checkout tables."})
                return

            filepath = "active_orders.json"
            orders = {}
            if os.path.exists(filepath):
                try:
                    with open(filepath, "r") as f:
                        orders = json.load(f)
                except Exception:
                    pass

            table_key = f"table_{table_no}"
            if table_key not in orders:
                self.send_api_json(404, {"status": "error", "message": "No active orders found for this table"})
                return

            table_session = orders[table_key]
            all_items = []
            subtotal = 0
            for ord_round in table_session.get("orders", []):
                for item in ord_round.get("items", []):
                    all_items.append(item)
                    subtotal += float(item.get("price", 0)) * int(item.get("quantity", 1))

            customer_name = table_session.get("customer_name", "Guest")
            customer_phone = table_session.get("customer_phone", "")

            service_charge = round(subtotal * 0.10, 2)
            tax = round(subtotal * 0.05, 2)
            total = round(subtotal + service_charge + tax, 2)

            invoice = {
                "invoice_id": f"INV-{int(time.time() * 1000)}",
                "table_no": table_no,
                "customer_name": customer_name,
                "customer_phone": customer_phone,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "subtotal": subtotal,
                "service_charge": service_charge,
                "tax": tax,
                "total": total,
                "items": all_items
            }

            invoices_filepath = "invoices.json"
            invoices = []
            if os.path.exists(invoices_filepath):
                try:
                    with open(invoices_filepath, "r") as f:
                        invoices = json.load(f)
                except Exception:
                    pass
            invoices.append(invoice)
            with open(invoices_filepath, "w") as f:
                json.dump(invoices, f, indent=2)

            del orders[table_key]
            with open(filepath, "w") as f:
                json.dump(orders, f, indent=2)

            # Generate and dispatch customer SMS notification (FR-23)
            host = self.headers.get("Host", "localhost:8080")
            sms_message = f"Thank You for Visiting Downtown Luka, Here's your e-bill: http://{host}/invoice.html?id={invoice['invoice_id']}"
            
            sms_filepath = "sms_sent.json"
            sms_logs = []
            if os.path.exists(sms_filepath):
                try:
                    with open(sms_filepath, "r") as f:
                        sms_logs = json.load(f)
                except Exception:
                    pass
            sms_logs.append({
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "to": customer_phone,
                "message": sms_message
            })
            with open(sms_filepath, "w") as f:
                json.dump(sms_logs, f, indent=2)

            self.log_audit_event("System", f"Sent SMS e-bill to customer (+91 {customer_phone})")
            self.log_audit_event(staff, f"Generated Invoice for Table {table_no}. Total: ₹{total}")
            
            self.send_api_json(200, {
                "status": "success", 
                "invoice": invoice,
                "sms_sent": True,
                "sms_message": sms_message
            })
        except Exception as e:
            print(f"[CHECKOUT ERROR] {e}")
            self.send_api_json(500, {"status": "error", "message": f"Failed to checkout: {e}"})

    def handle_get_invoices(self):
        user = self.headers.get("X-Staff-User", "System")
        user = urllib.parse.unquote(user)

        role = "Staff"
        if os.path.exists("users.json"):
            try:
                with open("users.json", "r") as f:
                    users_db = json.load(f)
                profile = users_db.get(user.lower())
                if isinstance(profile, dict):
                    role = profile.get("role", "Staff")
            except Exception:
                pass

        if role not in ["Admin", "Owner"]:
            self.send_api_json(403, {"status": "error", "message": "Permission Denied: Only Admin or Owner can view billing reports."})
            return

        invoices_filepath = "invoices.json"
        invoices = []
        if os.path.exists(invoices_filepath):
            try:
                with open(invoices_filepath, "r") as f:
                    invoices = json.load(f)
            except Exception:
                pass
        self.send_api_json(200, sorted(invoices, key=lambda x: x.get("timestamp", ""), reverse=True))

    def handle_request_checkout(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            data = json.loads(body)

            table_no = str(data.get("table_no", "")).strip()
            if not table_no:
                self.send_api_json(400, {"status": "error", "message": "Missing table number"})
                return

            filepath = "active_orders.json"
            orders = {}
            if os.path.exists(filepath):
                try:
                    with open(filepath, "r") as f:
                        orders = json.load(f)
                except Exception:
                    pass

            table_key = f"table_{table_no}"
            if table_key in orders:
                orders[table_key]["status"] = "Checkout Requested"
                with open(filepath, "w") as f:
                    json.dump(orders, f, indent=2)

                self.log_audit_event("Customer", f"Table {table_no} requested final bill settlement")
                self.send_api_json(200, {"status": "success", "message": "Checkout requested successfully"})
            else:
                self.send_api_json(404, {"status": "error", "message": "Active session not found"})
        except Exception as e:
            self.send_api_json(500, {"status": "error", "message": f"Failed to request checkout: {e}"})

    def handle_get_single_invoice(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        invoice_id = params.get("id", [None])[0]

        if not invoice_id:
            self.send_api_json(400, {"status": "error", "message": "Missing invoice id"})
            return

        invoices_filepath = "invoices.json"
        invoices = []
        if os.path.exists(invoices_filepath):
            try:
                with open(invoices_filepath, "r") as f:
                    invoices = json.load(f)
            except Exception:
                pass

        match = None
        for inv in invoices:
            if inv.get("invoice_id") == invoice_id:
                match = inv
                break

        if match:
            self.send_api_json(200, match)
        else:
            self.send_api_json(404, {"status": "error", "message": "Invoice not found"})

    def send_api_json(self, status_code, payload):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    pass

if __name__ == "__main__":
    initialize_seed_data()
    server_address = ("", PORT)
    httpd = ThreadingHTTPServer(server_address, DowntownLukaHandler)
    print(f"\n[Downtown Luka CMS Server] Live at: http://localhost:{PORT}")
    print("Press Ctrl+C to terminate server.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Downtown Luka Server] Shutting down.")
        httpd.server_close()
