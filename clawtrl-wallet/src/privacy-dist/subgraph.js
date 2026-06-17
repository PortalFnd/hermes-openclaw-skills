"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubgraphClient = void 0;
const graphql_request_1 = require("graphql-request");
const SUBGRAPH_URLS = {
    'base': 'https://api.studio.thegraph.com/query/1716033/privacy-pool-base/v0.0.2',
    'polygon': 'https://api.studio.thegraph.com/query/1716033/privacy-pool-polygon/v0.0.1',
};
const GET_ALL_COMMITMENTS = (0, graphql_request_1.gql) `
  query GetAllCommitments($first: Int!, $skip: Int!) {
    commitments(
      first: $first
      skip: $skip
      orderBy: blockNumber
      orderDirection: asc
    ) {
      id
      leafIndex
      amount
      blockNumber
      blockTimestamp
      transactionHash
      transactionIndex
      isSpent
    }
  }
`;
const GET_POOL_STATS = (0, graphql_request_1.gql) `
  query GetPoolStats {
    poolStats(id: "1") {
      totalDeposits
      totalPayments
      totalCommitments
      totalSpentCommitments
      currentRootIndex
      latestRoot
    }
  }
`;
class SubgraphClient {
    constructor(chainName) {
        const url = SUBGRAPH_URLS[chainName.toLowerCase()];
        if (!url) {
            throw new Error(`No subgraph URL for chain: ${chainName}`);
        }
        this.client = new graphql_request_1.GraphQLClient(url);
        this.chainName = chainName;
    }
    async getAllCommitments() {
        console.log(`Fetching commitments from subgraph for ${this.chainName}...`);
        const allCommitments = [];
        const batchSize = 1000;
        let skip = 0;
        while (true) {
            const data = await this.client.request(GET_ALL_COMMITMENTS, { first: batchSize, skip });
            allCommitments.push(...data.commitments);
            if (data.commitments.length < batchSize) {
                break;
            }
            skip += batchSize;
        }
        console.log(`Found ${allCommitments.length} commitments from subgraph`);
        return allCommitments;
    }
    async getPoolStats() {
        const data = await this.client.request(GET_POOL_STATS);
        return data.poolStats;
    }
}
exports.SubgraphClient = SubgraphClient;
