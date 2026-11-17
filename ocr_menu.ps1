# Load Windows Runtime types
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]

$images = Get-ChildItem "c:\Users\sansk\OneDrive\Desktop\Antigravity\Downtown Luka Menu" -Filter "*.jpeg"
$ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

if ($ocrEngine -eq $null) {
    Write-Host "[ERROR] OCR engine could not be initialized. Please check Windows language pack configuration."
    exit
}

$outputFile = "c:\Users\sansk\OneDrive\Desktop\Antigravity\Downtown Luka Menu\extracted_menu_text.txt"
"--- Downtown Luka Menu OCR Extraction ---" | Out-File $outputFile

# Helper function to wait for WinRT IAsyncOperation
function Wait-WinRT($asyncOp) {
    while ($asyncOp.Status -eq 'Started' -or $asyncOp.Status -eq 0) {
        Start-Sleep -Milliseconds 50
    }
    return $asyncOp.GetResults()
}

foreach ($img in $images) {
    Write-Host "Running OCR on $($img.Name)..."
    Add-Content $outputFile "`n========================================`n=== FILE: $($img.Name) `n========================================`n"
    
    try {
        # Open file natively in WinRT
        $storageFile = Wait-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($img.FullName))
        
        $stream = Wait-WinRT ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read))
        
        # Decode image
        $decoder = Wait-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
        
        $softwareBitmap = Wait-WinRT ($decoder.GetSoftwareBitmapAsync())
        
        # Recognize text
        $ocrResult = Wait-WinRT ($ocrEngine.RecognizeAsync($softwareBitmap))
        
        # Output lines to text database
        $lines = $ocrResult.Lines | ForEach-Object { $_.Text }
        $lines | Add-Content $outputFile
        
        $stream.Dispose()
    } catch {
        Write-Host "Failed to process $($img.Name): $_"
        Add-Content $outputFile "Failed to process image: $_"
    }
}

Write-Host "[SUCCESS] Extracted text saved to $outputFile"
