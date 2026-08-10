import "dotenv/config";
import { encryptSecret, decryptSecret } from "../src/lib/crypto";

const original = "sk-test-1234567890abcdef";
const ciphertext = encryptSecret(original);
const decrypted = decryptSecret(ciphertext);

console.log("Original: ", original);
console.log("Ciphertext:", ciphertext);
console.log("Decrypted:", decrypted);
console.log("Match:", original === decrypted);
