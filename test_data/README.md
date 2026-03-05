---
license: cc-by-4.0
task_categories:
- question-answering
language:
- en
tags:
- factuality
- grounding
- benchmark
- Google DeepMind
- Google Research
pretty_name: FACTS Grounding Public Examples
size_categories:
- n<1K
configs:
- config_name: "examples"
  default: true
  data_files:
  - split: "public"
    path: "examples.csv"
- config_name: "evaluation_prompts"
  data_files:
  - split: "prompts" 
    path: "evaluation_prompts.csv"
---
# FACTS Grounding 1.0 Public Examples
#### 860 public FACTS Grounding examples from Google DeepMind and Google Research

FACTS Grounding is a benchmark from Google DeepMind and Google Research designed to measure the performance of AI Models on factuality and grounding. 

▶ [FACTS Grounding Leaderboard on Kaggle](https://www.kaggle.com/facts-leaderboard)\
▶ [Technical Report](https://storage.googleapis.com/deepmind-media/FACTS/FACTS_grounding_paper.pdf)\
▶ [Evaluation Starter Code](https://www.kaggle.com/code/andrewmingwang/facts-grounding-benchmark-starter-code)\
▶ [Google DeepMind Blog Post](https://deepmind.google/discover/blog/facts-grounding-a-new-benchmark-for-evaluating-the-factuality-of-large-language-models)


## Usage

The FACTS Grounding benchmark evaluates the ability of Large Language Models (LLMs) to generate factually accurate responses 
grounded in provided long-form documents, encompassing a variety of domains. FACTS Grounding moves beyond simple factual 
question-answering by assessing whether LLM responses are fully grounded to the provided context and correctly synthesize 
information from a long context document. By providing a standardized evaluation framework, FACTS Grounding aims to 
promote the development of LLMs that are both knowledgeable and trustworthy, facilitating their responsible deployment 
in real-world applications.

## Dataset Description

This dataset is a collection 860 examples (public set) crafted by humans for evaluating how well an AI system grounds their answers to a given context. Each example is composed of a few parts:

* A system prompt (`system_instruction`) which provides general instructions to the model, including to only answer the question provided based on the information in the given context
* A task (`user_request`) which includes the specific question(s) for the system to answer e.g. "*What are some tips on saving money?*"
* A long document (`context_document`) which includes information necessary to answer to question e.g. an SEC filing for a publicly traded US company

This dataset also contains evaluation prompts (`evaluation_prompts.csv`) for judging model generated responses to the examples. See the [Technical Report](https://storage.googleapis.com/deepmind-media/FACTS/FACTS_grounding_paper.pdf) for methodology details.

## Limitations
While this benchmark represents a step forward in evaluating factual accuracy, more work remains to be done. First, this benchmark relies on potentially noisy automated LLM judge models for evaluation. By ensembling a range of frontier LLMs and averaging judge outputs, we attempt to mitigate this. Second, the FACTS benchmark focuses only on evaluating grounded responses to long-form text input and could potentially be extended.

Questions, comments, or issues? Share your thoughts with us in the [discussion forum](https://www.kaggle.com/facts-leaderboard/discussion).

## Citation

If you use this dataset in your research, please cite our technical report:
```
@misc{kaggle-FACTS-leaderboard,
    author = {Alon Jacovi,  Andrew Wang,  Chris Alberti,  Connie Tao,  Jon Lipovetz,  Kate Olszewska,  Lukas Haas,  Michelle Liu,  Nate Keating,  Adam Bloniarz,  Carl Saroufim,  Corey Fry,  Dror Marcus,  Doron Kukliansky,  Gaurav Singh Tomar,  James Swirhun,  Jinwei Xing,  Lily Wang,  Michael Aaron,  Moran Ambar,  Rachana Fellinger,  Rui Wang,  Ryan Sims,  Zizhao Zhang,  Sasha Goldshtein,  Yossi Matias,  and Dipanjan Das},
    title = {FACTS Leaderboard},
    year = {2024},
    howpublished = {\url{https://kaggle.com/facts-leaderboard}},
    note = {Google DeepMind, Google Research, Google Cloud, Kaggle}
}
```