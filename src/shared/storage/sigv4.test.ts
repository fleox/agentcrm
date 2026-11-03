import { describe, expect, it } from "vitest";
import { sha256Hex, signRequest } from "./sigv4";

// Vectors from the AWS Signature Version 4 test suite ("get-vanilla",
// "get-vanilla-query-order-key-case").
const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
};
const date = new Date("2015-08-30T12:36:00Z");

describe("signRequest", () => {
  it("matches get-vanilla", async () => {
    const headers = await signRequest({
      method: "GET",
      url: "https://example.amazonaws.com/",
      headers: {},
      payloadHash: await sha256Hex(""),
      credentials,
      date,
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("matches get-vanilla-query-order-key-case", async () => {
    const headers = await signRequest({
      method: "GET",
      url: "https://example.amazonaws.com/?Param2=value2&Param1=value1",
      headers: {},
      payloadHash: await sha256Hex(""),
      credentials,
      date,
    });
    expect(headers.Authorization).toContain(
      "Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
    );
  });
});
