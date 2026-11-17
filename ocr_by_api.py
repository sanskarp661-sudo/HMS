import os
import base64
import json
import urllib.request
import urllib.parse
import time

API_KEY = "helloworld"  # Free test API key
OCR_URL = "https://api.ocr.space/parse/image"
IMAGE_DIR = r"c:\Users\sansk\OneDrive\Desktop\Antigravity\Downtown Luka Menu"
OUTPUT_FILE = os.path.join(IMAGE_DIR, "extracted_menu_text.txt")

images = [f for f in os.listdir(IMAGE_DIR) if f.lower().endswith(".jpeg")]
print(f"Found {len(images)} images to process.")

with open(OUTPUT_FILE, "w", encoding="utf-8") as out:
    out.write("--- Downtown Luka Menu OCR API Extraction ---\n")

for img_name in images:
    img_path = os.path.join(IMAGE_DIR, img_name)
    print(f"Sending {img_name} to OCR API...")
    
    try:
        # Read and encode image to base64
        with open(img_path, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("utf-8")
        
        base64_str = f"data:image/jpeg;base64,{b64_data}"
        
        # Prepare POST payload
        payload = urllib.parse.urlencode({
            "apikey": API_KEY,
            "language": "eng",
            "base64Image": base64_str,
            "isOverlayRequired": "false"
        }).encode("utf-8")
        
        req = urllib.request.Request(
            OCR_URL,
            data=payload,
            headers={
                "Content-Type": "application/x-www-form-urlencoded"
            },
            method="POST"
        )
        
        # Call API
        with urllib.request.urlopen(req, timeout=30) as response:
            res_json = json.loads(response.read().decode("utf-8"))
            
            # Write results
            with open(OUTPUT_FILE, "a", encoding="utf-8") as out:
                out.write(f"\n========================================\n=== FILE: {img_name}\n========================================\n")
                
                if res_json.get("OCRExitCode") == 1:
                    parsed_results = res_json.get("ParsedResults", [])
                    for result in parsed_results:
                        text = result.get("ParsedText", "")
                        out.write(text)
                        print(f"Success transcribing {img_name}")
                else:
                    err_msg = res_json.get("ErrorMessage", "Unknown API error")
                    out.write(f"API Error: {err_msg}\n")
                    print(f"API returned error for {img_name}: {err_msg}")
                    
        # Free API key rate limit throttle
        time.sleep(3)
        
    except Exception as e:
        print(f"Error processing {img_name}: {e}")
        with open(OUTPUT_FILE, "a", encoding="utf-8") as out:
            out.write(f"\nError processing {img_name}: {e}\n")

print(f"Finished. Extracted text is saved at {OUTPUT_FILE}")
