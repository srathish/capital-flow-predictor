=================== lefterisloukas/edgar-crawler
# EDGAR-CRAWLER: Extract Key Financial Data from SEC Filings Effortlessly 🚀
![EDGAR-CRAWLER-LOGO](images/edgar-crawler-logo-white-bg.jpeg)
**EDGAR-CRAWLER** is the only open-source toolkit that **downloads** **raw** and unstructured financial **SEC filings** from EDGAR and parses them **into** **structured JSON files** in order to **boot
---
**EDGAR-CRAWLER** has 2 core functionalities:
- 📥 **Seamless downloading**: Retrieve and download financial filings from all US publicly-traded companies based on your specified filters, like year, quarters, filing type, etc.
- 🔍 **Structured JSON parsing**: Extract and parse specific key item sections from 10-K, 10-Q, and 8-K filings into a nice-and-clean standardized JSON format.  *(filings supported: 10-K, 10-Q, 8-K)
## 🚨 News
- 2025/05: We presented EDGAR-CRAWLER and its paper at WWW 2025, which was held in Sydney. (https://dl.acm.org/doi/10.1145/3701716.3715289)
- 2024/10: We now support **structured JSON output for 10-Q and 8-K** filings. ([@Bailefan](https://github.com/Bailefan))
- 2023/12: We had a Lightning Talk about EDGAR-CRAWLER at the 3rd Workshop for Natural Language Processing Open Source Software [(NLP-OSS)](https://nlposs.github.io/2023/), hosted at EMNLP 2023, in Si
- 2023/01: EDGAR-CORPUS, the biggest financial NLP corpus (generated from EDGAR-CRAWLER!), is available as a HuggingFace 🤗 dataset card. See [Accompanying Resources](#Accompanying-Resources).
- 2022/10: Updated documentation and fixed a minor import bug affecting older Python versions.
- 2022/04: EDGAR-CRAWLER is available for Windows systems too.
- 2021/11: We presented EDGAR-CORPUS, our "parent" project that started it all, at [ECONLP 2021](https://lt3.ugent.be/econlp/) (EMNLP Workshop) at the Dominican Republic. See [Accompanying Resources](
## Table of Contents
- [Example JSON Outputs](#example-json-outputs)
- [Install](#install)
- [Usage](#usage)
- [Citation](#citation)
- [Accompanying Resources](#accompanying-resources)
- [Feedback](#feedback)
- [Contributing](#contributing)
- [Issues](#issues)
## Example JSON Outputs
Other than downloading the raw filings, **EDGAR-CRAWLER** is the only open-source toolkit that converts the complex and unstructured SEC filings to **structured JSON outputs** for easier integration t
### 10-K filing (Annual Report)
Original report: [Apple 10-K from 2022](https://www.sec.gov/Archives/edgar/data/320193/000032019322000108/aapl-20220924.htm)
=================== alphanome-ai/sec-parser
  <h1 align="center"><b>This repository is no longer maintained.</b></h1>
  <h1 align="center"><b>SEC-parser</b></h1>
  <!-- Using &nbsp; for alignment due to GitHub README limitations -->
  <b>Essentials ➔&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b>
  <!-- NOTE: After changing stability level here, also change it in pyproject.toml -->
  <br>
  <b>Health ➔&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b>
  <br>
  <b>Quality ➔&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</b>
  <br>
  <b>Distribution ➔&nbsp;&nbsp;&nbsp;</b>
  <br>
  <b>Community ➔&nbsp;&nbsp;&nbsp;&nbsp;</b>
  Parse SEC EDGAR HTML documents into a tree of elements that correspond to the visual structure of the document.
<br>
  <b>
  <a href="https://parser.alphanome.app">See Demo</a> |
  <a href="https://sec-parser.rtfd.io">Read Docs</a> |
  <a href="https://github.com/orgs/alphanome-ai/discussions">Join Discussions</a> |
  <a href="https://discord.gg/2MC3uJhBxs">Join Discord</a>
  </b>
<br>
# Overview
The `sec-parser` project simplifies extracting meaningful information from SEC EDGAR HTML documents by organizing them into semantic elements and a tree structure. Semantic elements might include sect
This tool is especially beneficial for Artificial Intelligence (AI), Machine Learning (ML), and Large Language Models (LLM) applications by streamlining data pre-processing and feature extraction.
- Explore the [**Demo**](https://parser.alphanome.app)
- Read the [**Documentation**](https://sec-parser.rtfd.io)
- Join the [**Discussions**](https://github.com/orgs/alphanome-ai/discussions) to get help, propose ideas, or chat with the community
=================== virattt/ai-hedge-fund
# AI Hedge Fund
This is a proof of concept for an AI-powered hedge fund. The goal of this project is to explore the use of AI to make trading decisions. This project is for **educational** purposes only and is not in
<img width="2400" height="1460" alt="image" src="https://github.com/user-attachments/assets/e3985623-c226-4c1a-a587-e03fb4eca31e" />
Note: the system does not actually make any trades.
## Disclaimer
This project is for **educational and research purposes only**.
- Not intended for real trading or investment
- No investment advice or guarantees provided
- Creator assumes no liability for financial losses
- Consult a financial advisor for investment decisions
- Past performance does not indicate future results
By using this software, you agree to use it solely for learning purposes.
## How to Install
```bash
pipx install aihf
```
(or `uv tool install aihf`, or `pip install aihf` into an environment of your choice)
Then run it from anywhere:
```bash
aihf
```
### API keys
The app asks for keys the first time it needs them and saves them to `~/.hedge-fund/.env` — nothing to configure up front. It needs:
- A [Financial Datasets](https://financialdatasets.ai) API key, for prices, fundamentals, and earnings.
- One model API key for the investor agents. Supported providers: Anthropic, OpenAI, DeepSeek, Google, xAI, Kimi, TypeSafe (Jev).
Keys exported in your shell always win over the saved file.
## How to Run
### Interactive app
=================== microsoft/qlib
## :newspaper: **What's NEW!** &nbsp;   :sparkling_heart: 
Recent released features
We are excited to announce the release of **RD-Agent**📢, a powerful tool that supports automated factor mining and model optimization in quant investment R&D.
RD-Agent is now available on [GitHub](https://github.com/microsoft/RD-Agent), and we welcome your star🌟!
To learn more, please visit the [RD-Agent repository](https://github.com/microsoft/RD-Agent). We have prepared several public demo videos for you:
| Scenario | Demo video (English) | Demo video (中文) |
| --                      | ------    | ------    |
| Quant Factor Mining | [YouTube](https://www.youtube.com/watch?v=X4DK2QZKaKY&t=6s) | [YouTube](https://www.youtube.com/watch?v=X4DK2QZKaKY&t=6s) |
| Quant Factor Mining from reports | [YouTube](https://www.youtube.com/watch?v=ECLTXVcSx-c) | [YouTube](https://www.youtube.com/watch?v=ECLTXVcSx-c) |
| Quant Model Optimization | [YouTube](https://www.youtube.com/watch?v=dm0dWL49Bc0&t=104s) | [YouTube](https://www.youtube.com/watch?v=dm0dWL49Bc0&t=104s) |
- 📃**Paper**: [R&D-Agent-Quant: A Multi-Agent Framework for Data-Centric Factors and Model Joint Optimization](https://arxiv.org/abs/2505.15155)
- 👾**Code**: https://github.com/microsoft/RD-Agent/
```BibTeX
@misc{li2025rdagentquant,
    title={R\&D-Agent-Quant: A Multi-Agent Framework for Data-Centric Factors and Model Joint Optimization},
    author={Yuante Li and Xu Yang and Xiao Yang and Minrui Xu and Xisen Wang and Weiqing Liu and Jiang Bian},
    year={2025},
    eprint={2505.15155},
    archivePrefix={arXiv},
    primaryClass={cs.AI}
}
```
![image](https://github.com/user-attachments/assets/3198bc10-47ba-4ee0-8a8e-46d5ce44f45d)
***
| Feature | Status |
| --                      | ------    |
| [R&D-Agent-Quant](https://arxiv.org/abs/2505.15155) Published | Apply R&D-Agent to Qlib for quant trading | 
| BPQP for End-to-end learning | 📈Coming soon!([Under review](https://github.com/microsoft/qlib/pull/1863)) |
=================== zanistaai/AI-in-Finance
# S&P 500 AI Focus Pipeline
This project analyzes **S&P 500 companies** to identify those most **focused on Artificial Intelligence (AI)**.  
It pulls company information from Yahoo Finance, generates embeddings using OpenAI, clusters similar firms,  
and ranks them by how closely their business descriptions match an “AI-focused company” profile.
<img width="1600" height="936" alt="image" src="https://github.com/user-attachments/assets/85cc9246-5aa5-414b-bdd3-7f72cbe73008" />
---
## What the Script Does
1. **Load S&P 500 Company Data**  
   Reads `SP500.xlsx`, filters for equities, and extracts ticker symbols.
2. **Fetch Company Descriptions**  
   Retrieves each company’s long business summary from Yahoo Finance, with automatic retry and delay to avoid rate limits.
3. **Generate Embeddings (Text Vectors)**  
   Sends company descriptions to OpenAI’s `text-embedding-3-large` model, which converts text into numeric vectors representing meaning.
4. **Cluster Similar Companies**  
   Uses K-Means clustering to group companies with similar business descriptions.
5. **Score AI-Related Similarity**  
   Compares each company’s embedding to a predefined embedding representing an *AI-focused company*.  
   Uses cosine similarity to quantify how “AI-related” each business is.
6. **Rank and Split Companies**  
   Ranks companies by AI similarity.  
   - Top 50 → AI-focused companies  
   - Bottom 50 → Non-AI-focused companies
7. **Fetch 5-Year Price Data**  
   Downloads 5 years of daily adjusted stock prices for:
   - AI-focused companies  
   - Non-AI-focused companies  
   - The S&P 500 index (^GSPC)
8. **Save Results**  
=================== fire-institute/fire
# F.I.R.E. Factor Investment Research Engine
This repo is the bundled opensource toolkit for book _Navigating the Factor Zoo：The Science of Quantitative Investing_.
## Installation
```bash
# for stable version
pip install firefin
# for test and nightly version
pip install -i https://test.pypi.org/simple/ firefin
# Install from source for loacl testing!!!
## replace $ThisRepoURL with the actual repo url
git clone $ThisRepoURL 
## install from source
pip install -e .
```
## Usage
Download the data 
from [here](https://github.com/fire-institute/fire/releases/download/marketdata/AStockData.tar.gz)
run the command and download data put in correct path automatically.
```bash
# We have not released this repo yet, so you need download the data manually!!! See command below!!!
# Auto download data
firefin download
```
If you have already downloaded the data from [here](https://github.com/fire-institute/fire/releases/download/marketdata/AStockData.tar.gz), you can run the command to check the data and put the data i
```bash
# replace path_to_data.tar.gz with the actual path
firefin load path_to_data.tar.gz
```
=================== xbtlin/ai-berkshire
中文 | [English](README_EN.md) | [日本語](README_JA.md)
# AI Berkshire - AI 时代的价值投资研究框架
> "Price is what you pay, value is what you get." — Warren Buffett
>
> 用 AI 重新定义投资研究的深度与效率。
**AI Berkshire** 是一套同时兼容 Claude Code 与 Codex 的投资研究 Skill 合集，将巴菲特、芒格、段永平、李录四位价值投资大师的方法论系统化、结构化，通过
一个人 + Claude Code / Codex = 一个投研团队。
> 📮 **仓库是全量框架，公众号是精选。** 真正值得深研的公司，加上报告之外我自己的判断与取舍，都在微信公众号「**复利炼丹炉**」——[扫码关注
<!-- REPORTS-BANNER:START 由 tools/reports_index.py 自动更新，勿手改 -->
> 📊 **日更内容是研究报告，全部在 [研究报告索引](reports/README.md)。** 2377 份报告 · 111 家公司 · 23 个专题，按公司与专题分组，更新至 2026-09-28。
<!-- REPORTS-BANNER:END -->
[实盘业绩](#real-track-record) · [为什么不能直接问AI](#为什么不能直接问-ai) · [Skills 一览](#skills-一览20个) · [快速开始](#快速开始) · [实战报告](#实战研�
---
## Real Track Record
> 不是纸上谈兵。这套框架背后是真金白银验证的投资体系。
### 2024 全年收益：+69.29%
### 2025 全年收益：+66.38%
### 与主要指数对比
| 指标 | 2024 全年 | 2025 全年 |
|------|----------|----------|
| **本框架实盘** | **+69.29%** | **+66.38%** |
| 恒生指数 | +17.67% | +27.77% |
| 标普500 | +23.31% | +16.39% |
| 沪深300 | +14.68% | +17.66% |
| 纳斯达克 | +28.64% | +20.36% |
**2024 年超额收益**：跑赢标普500 **46个百分点**，跑赢恒生指数 **52个百分点**
**2025 年超额收益**：跑赢标普500 **50个百分点**，跑赢恒生指数 **39个百分点**
**两年累计实盘收益超 146万元**，连续两年大幅跑赢全球主要指数。
