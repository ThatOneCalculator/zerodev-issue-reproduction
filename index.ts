import { avalancheFuji } from "viem/chains";
import { FactoryAbi } from "./FactoryAbi";
import { ENTRYPOINT_ADDRESS_V07, bundlerActions } from "permissionless";
import { encodeFunctionData } from "viem";
import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { RemoteSignerMode, toRemoteSigner } from "@zerodev/remote-signer";
import {
	createKernelAccountClient,
	createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { http, createPublicClient } from "viem";

const zerodevApiKey = Bun.env.ZERODEV_SECRET_KEY as string;

const FAKE_HASH = "0x000";

const remoteSigner = await toRemoteSigner({
	apiKey: zerodevApiKey,
	keyAddress: FAKE_HASH,
	mode: RemoteSignerMode.Get,
});
const ecdsaSigner = toECDSASigner({ signer: remoteSigner });

async function getSessionKeyAccount() {
	const publicClient = createPublicClient({
		transport: http(avalancheFuji.rpcUrls.default.http[0]),
	});

	const sessionKeyAccount = await deserializePermissionAccount(
		publicClient,
		ENTRYPOINT_ADDRESS_V07,
		KERNEL_V3_1,
		FAKE_HASH, // approval
		ecdsaSigner,
	);
	return sessionKeyAccount;
}

async function getKernelAccount() {
	const account = await getSessionKeyAccount();
	const zerodevBundlerRpc = `https://rpc.zerodev.app/api/v2/bundler/${Bun.env.ZERODEV_PROJECT_ID}`;
	const zerodevPaymasterRpc = `https://rpc.zerodev.app/api/v2/paymaster/${Bun.env.ZERODEV_PROJECT_ID}`;

	const walletClient = createKernelAccountClient({
		account,
		chain: avalancheFuji,
		entryPoint: ENTRYPOINT_ADDRESS_V07,
		bundlerTransport: http(zerodevBundlerRpc),
		middleware: {
			sponsorUserOperation: async ({ userOperation }) => {
				const zerodevPaymaster = createZeroDevPaymasterClient({
					chain: avalancheFuji,
					entryPoint: ENTRYPOINT_ADDRESS_V07,
					transport: http(zerodevPaymasterRpc),
				});
				return zerodevPaymaster.sponsorUserOperation({
					userOperation,
					entryPoint: ENTRYPOINT_ADDRESS_V07,
				});
			},
		},
	});
	return walletClient;
}

export async function chainCreateMarket() {
	const sessionKeyAccount = await getSessionKeyAccount();
	const kernelAccount = await getKernelAccount();

	const usdcAddress = "0x5425890298aed601595a70ab815c96711a31bc65"; // Avalanche Fuji USDC

	try {
		const callData = await sessionKeyAccount.encodeCallData({
			to: FAKE_HASH, // factorty address
			value: BigInt(0),
			data: encodeFunctionData({
				abi: FactoryAbi,
				functionName: "createMarket",
				args: [
					usdcAddress,
					"Fake question",
					"Fake rules",
					BigInt(999999999998),
					BigInt(3),
				],
			}),
		});

		console.log("callData", callData);

		const userOpHash = await kernelAccount.sendUserOperation({
			// Error occurs here!
			userOperation: {
				callData: callData,
				callGasLimit: CREATE_GAS_LIMIT,
			},
		});

		console.log("userOp hash:", userOpHash);

		const bundlerClient = kernelAccount.extend(
			bundlerActions(ENTRYPOINT_ADDRESS_V07),
		);
		const _receipt = await bundlerClient.waitForUserOperationReceipt({
			hash: userOpHash,
		});

		return _receipt.receipt.transactionHash;
	} catch (error) {
		console.log("Error creating market:", error);
		throw error;
	}
}
