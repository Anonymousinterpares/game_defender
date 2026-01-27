import os
import sys
import requests
import json

def test_key():
    # Try to load from .env file
    api_key = None
    if os.path.exists('.env'):
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    api_key = line.split('=')[1].strip()
                    break
    
    if not api_key or api_key == 'your_api_key_here':
        print("ERROR: No valid API key found in .env file.")
        print("Please replace 'your_api_key_here' in .env with your real key.")
        return

    print(f"Testing API Key: {api_key[:4]}...{api_key[-4:]}")
    
    # Try a simple list models call to verify the key
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}" 
    
    try:
        response = requests.get(url)
        if response.status_code == 200:
            print("SUCCESS: API Key is valid!")
            models = response.json().get('models', [])
            print(f"Available models: {len(models)}")
            for m in models:
                print(f" - {m['name']}")
            # Check for a specific model used in the app
            has_pro = any('gemini-1.5-pro' in m['name'] for m in models)
            print(f"Has Gemini 1.5 Pro access: {has_pro}")
        else:
            print(f"FAILED: API call returned status {response.status_code}")
            print(f"Response: {response.text}")
            
            if "QUOTA_EXCEEDED" in response.text:
                print("\n--- QUOTA ERROR DETECTED ---")
                print("Your API key has reached its limit or has no quota.")
    except Exception as e:
        print(f"ERROR: {str(e)}")

if __name__ == "__main__":
    test_key()
