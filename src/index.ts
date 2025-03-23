import algosdk, { Account, waitForConfirmation } from "algosdk";
import * as algokit from "@algorandfoundation/algokit-utils";
import * as dotenv from "dotenv";
import client from "algosdk/dist/types/client/client";
import {
  TransactionSignerAccount,
  SigningAccount,
} from "@algorandfoundation/algokit-utils/types/account";
import {
  AppClient,
  ApplicationClient,
} from "@algorandfoundation/algokit-utils/types/app-client";
import { SMART_CONTRACT_ARC_32 } from "./client";

dotenv.config();

// The app ID to interact with.
const appId = 736014374;

// Account address
// H5LSK2ZS2F7AT3Q3UDWCXRIZMOU47SBPFNO5LZBANFPKJY72A3T7WFLWSE

async function loadClient() {
  const client = algokit.AlgorandClient.fromConfig({
    algodConfig: {
      server: "https://testnet-api.algonode.cloud",
    },
    indexerConfig: {
      server: "https://testnet-idx.algonode.cloud",
    },
  });

  return client;
}

const main = async () => {
  const client = await loadClient();
  const key = process.env.MNEMONIC_KEY;

  if (!key) {
    throw new Error("MNEMONIC_KEY is not defined in environment variables.");
  }

  const account = algosdk.mnemonicToSecretKey(key);

  const assetId = await getAssetIdFromAppInfo(appId, "asset");

  await optInASA(account, assetId);

  await claimAsset(account, assetId);
};

const getAssetIdFromAppInfo = async (appId: number, keyName: string) => {
  const client = await loadClient();
  const appResponse = await client.client.indexer
    .lookupApplications(appId)
    .do();

  if (!appResponse.application || !appResponse.application.params) {
    throw new Error("Application not found or has no parameters.");
  }

  const globalState = appResponse.application.params["global-state"] || [];

  for (const entry of globalState) {
    const decodedKey = Buffer.from(entry.key, "base64").toString("utf-8");

    if (decodedKey === keyName) {
      const value = entry.value.uint || entry.value.bytes || null;
      return value;
    }
  }
  return null;
};

const optInASA = async (acct: Account, assetId: number) => {
  const client = await loadClient();
  const params = await client.client.algod.getTransactionParams().do();

  const accountInfo = await client.client.algod
    .accountInformation(acct.addr)
    .do();

  const alreadyOptedIn = accountInfo.assets.some(
    (a: any) => a["asset-id"] === assetId
  );

  if (alreadyOptedIn) {
    console.log(`Already opted in to asset with id: ${assetId}`);
    return;
  }

  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: acct.addr,
    to: acct.addr,
    suggestedParams: params,
    assetIndex: assetId,
    amount: 0,
  });

  const signedTxn = optInTxn.signTxn(acct.sk);
  await client.client.algod.sendRawTransaction(signedTxn).do();
  console.log(`${acct.addr} opted into asset ${assetId}`);
};

const claimAsset = async (account: Account, assetId: any) => {
  const client = await loadClient();

  const signer = algosdk.makeBasicAccountTransactionSigner(account);

  const accountInfo = await client.client.algod
    .accountInformation(account.addr)
    .do();

  const alreadyOptedIn = accountInfo.assets.some(
    (a: any) => a["asset-id"] === assetId && a["is-frozen"] === true
  );

  if (alreadyOptedIn) {
    console.log(`Already claimed asset with id: ${assetId}`);
    return;
  }

  const appClient = new ApplicationClient(
    {
      resolveBy: "id",
      id: appId,
      sender: account,
      app: JSON.stringify(SMART_CONTRACT_ARC_32),
    },
    client.client.algod
  );

  const params = await client.client.algod.getTransactionParams().do();

  const atomTransactionComposer = new algosdk.AtomicTransactionComposer();

  atomTransactionComposer.addMethodCall({
    method: appClient.getABIMethod("claimAsset")!,
    methodArgs: [],
    suggestedParams: {
      ...params,
      fee: 6_000,
      flatFee: true,
    },
    sender: account.addr,
    signer: signer,
    appID: appId,
    appForeignAssets: [assetId],
  });

  await atomTransactionComposer.execute(client.client.algod, 8);

  console.log(`${account.addr} has successfully claimed asset ${assetId}`);
};

main().catch(console.error);
