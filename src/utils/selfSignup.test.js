import test from "node:test";
import assert from "node:assert/strict";
import { validateOwnerSignUpInput } from "./selfSignup.js";

const validInput = {
  ownerName: "山田太郎",
  companyName: "テストサロン",
  email: "owner@example.com",
  password: "password123",
  passwordConfirm: "password123",
};

test("validateOwnerSignUpInput accepts fully filled, matching input", () => {
  assert.equal(validateOwnerSignUpInput(validInput), "");
});

test("validateOwnerSignUpInput requires ownerName", () => {
  assert.match(validateOwnerSignUpInput({ ...validInput, ownerName: "  " }), /オーナー名/);
});

test("validateOwnerSignUpInput requires companyName", () => {
  assert.match(validateOwnerSignUpInput({ ...validInput, companyName: "" }), /サロン名/);
});

test("validateOwnerSignUpInput requires email", () => {
  assert.match(validateOwnerSignUpInput({ ...validInput, email: "" }), /メールアドレス/);
});

test("validateOwnerSignUpInput rejects passwords shorter than 8 characters", () => {
  assert.match(validateOwnerSignUpInput({ ...validInput, password: "short", passwordConfirm: "short" }), /8文字以上/);
});

test("validateOwnerSignUpInput rejects mismatched password confirmation", () => {
  assert.match(validateOwnerSignUpInput({ ...validInput, passwordConfirm: "different123" }), /一致しません/);
});

test("validateOwnerSignUpInput skips confirmation check when passwordConfirm is not provided", () => {
  const rest = { ownerName: validInput.ownerName, companyName: validInput.companyName, email: validInput.email, password: validInput.password };
  assert.equal(validateOwnerSignUpInput(rest), "");
});
