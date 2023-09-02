import { ContractTransactionReceipt } from "ethers";
import { ethers } from "hardhat";
import ADDRESS from "../config/address-bnb.json";
import { CONFIGS } from "../config/address";
import { IApproveAndCall, PancakeV3Toaster } from "../typechain-types";
import { IPancakeV3Toaster } from "../typechain-types/contracts/toaster/PancakeV3Toaster";
async function deployMenu() {
  const menu_f = await ethers.getContractFactory("PancakeV3Menu");
  const menu = await menu_f.deploy().then((tx) => tx.waitForDeployment());

  return await menu.getAddress();
}
async function deployToaster(
  deployer: string,
  factory: string,
  positionManager: string,
  WETH9: string,
  menu: string
) {
  const toaster_f = await ethers.getContractFactory("PancakeV3Toaster");
  const toaster: PancakeV3Toaster = await toaster_f
    .deploy(deployer, factory, positionManager, WETH9, menu)
    .then((tx) => tx.waitForDeployment());

  return await toaster.getAddress();
}

async function test() {
  const signer = (await ethers.getSigners())[0];
  const menu = await deployMenu();
  const menuInstance = await ethers.getContractAt("PancakeV3Menu", menu);
  console.log("menu: ", menu);
  const toaster = await deployToaster(
    ADDRESS.PancakeV3PoolDeployer,
    ADDRESS.PancakeV3Factory,
    ADDRESS.NonfungiblePositionManager,
    ADDRESS.WBNB,
    menu
  );
  console.log("toaster: ", toaster);
  const toasterInstance = await ethers.getContractAt(
    "PancakeV3Toaster",
    toaster
  );
  const factory = await ethers.getContractAt(
    "IPancakeV3Factory",
    ADDRESS.PancakeV3Factory
  );
  const wbnb = await ethers.getContractAt("IWETH9", ADDRESS.WBNB);
  const usdt = await ethers.getContractAt("IERC20", ADDRESS.USDT);

  await wbnb.approve(await toasterInstance.getAddress(), ethers.MaxUint256);
  await usdt.approve(await toasterInstance.getAddress(), ethers.MaxUint256);
  await wbnb.deposit({
    value: ethers.parseEther("100"),
  });
  await toasterInstance.exactInputSingle({
    tokenIn: ADDRESS.WBNB,
    tokenOut: ADDRESS.USDT,
    fee: 2500,
    recipient: signer.address,
    amountIn: ethers.parseEther("1"),
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
    deadline: ethers.MaxUint256,
  });
  const toasterItf = toasterInstance.interface;
  const amount0 = 0n; // USDT
  const token0 = ADDRESS.USDT;
  const amount1 = ethers.parseEther("1"); // WBNB
  const token1 = ADDRESS.WBNB;
  const nativeInputAmount = 0n;

  const poolAddress = await factory.getPool(token0, token1, 2500);
  const slot0 = await ethers
    .getContractAt("IPancakeV3Pool", poolAddress)
    .then((t) => t.slot0());
  const tick = slot0.tick;
  const [swapAmountIn, swapAmountOut, isSwap0] =
    await menuInstance.getSwapAmountForAddLiquidity({
      pool: ADDRESS.POOL_WBNB_USDT,
      tickUpper: 50n * ((tick + 200n) / 50n),
      tickLower: 50n * ((tick - 300n) / 50n),
      amount0: amount0,
      amount1: amount1,
      height: 120,
    });

  const [tokenIn, tokenOut, amountIn, amountOut] = isSwap0
    ? [token0, token1, amount0, amount1]
    : [token1, token0, amount1, amount0];
  const exactInputSingleBySelfParams: IPancakeV3Toaster.ExactInputBySelfParamsStruct =
    {
      tokenIn,
      tokenOut,
      fee: 2500,
      amountIn: swapAmountIn,
    };

  const mintParams: IApproveAndCall.MintParamsStruct = {
    token0: tokenIn < tokenOut ? tokenIn : tokenOut,
    token1: tokenOut < tokenIn ? tokenIn : tokenOut,
    fee: 2500,
    tickUpper: 50n * ((tick + 200n) / 50n),
    tickLower: 50n * ((tick - 300n) / 50n),
    amount0Min: 0,
    amount1Min: 0,
    recipient: signer.address,
  };

  const multicallData: string[] = [];
  if (nativeInputAmount > 0n) {
    multicallData.push(
      toasterItf.encodeFunctionData("wrapETH", [nativeInputAmount])
    );
  }

  if (amountIn > 0n) {
    multicallData.push(
      toasterItf.encodeFunctionData("pull", [tokenIn, amountIn])
    );
  }
  if (amountOut > 0n) {
    multicallData.push(
      toasterItf.encodeFunctionData("pull", [tokenOut, amountOut])
    );
  }

  multicallData.push(
    toasterItf.encodeFunctionData("exactInputSingleBySelf", [
      exactInputSingleBySelfParams,
    ])
  );

  multicallData.push(
    toasterItf.encodeFunctionData("approveMax", [tokenIn]),
    toasterItf.encodeFunctionData("approveMax", [tokenOut]),
    toasterItf.encodeFunctionData("mint", [mintParams])
  );

  if (nativeInputAmount > 0n) {
    multicallData.push(
      toasterItf.encodeFunctionData("unwrapWETH9(uint256)", [0n]),
      toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
        tokenIn == token1 ? tokenOut : tokenIn,
        0n,
      ])
    );
  } else {
    multicallData.push(
      toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
        tokenIn,
        0n,
      ]), // sweepToken tokenIn
      toasterItf.encodeFunctionData("sweepToken(address,uint256)", [
        tokenOut,
        0n,
      ])
    );
  }
  const receipt = await toasterInstance["multicall(bytes[])"](multicallData, {
    value: nativeInputAmount,
  })
    .then((t) => t.wait())
    .then((receipt) => receipt as ContractTransactionReceipt);

  console.log(receipt);
}

async function main() {
  const menu = await deployMenu();
  console.log("menu: ", menu);
  await deployToaster(
    CONFIGS.linea.pancakeswapV3.meta.PancakeV3PoolDeployer,
    CONFIGS.linea.pancakeswapV3.meta.PancakeV3Factory,
    CONFIGS.linea.pancakeswapV3.meta.NonfungiblePositionManager,
    CONFIGS.linea.pancakeswapV3.wETH,
    menu
  ).then(async (t) => {
    console.log("toaster: ", t);
    const toaster = await ethers.getContractAt("PancakeV3Toaster", t);
    console.log(await toaster.fees(10));
  });
}
async function menu() {
  const toaster = await ethers.getContractAt(
    "PancakeV3Toaster",
    CONFIGS.arbitrum.pancakeswapV3.meta.Toaster
  );
  const menu = await toaster.menu();
  console.log(menu);
}
main();
// menu();
