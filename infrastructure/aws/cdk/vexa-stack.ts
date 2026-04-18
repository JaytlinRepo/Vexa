import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

export class VexaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ── VPC ────────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'VexaVPC', {
      maxAzs: 2,
      natGateways: 1,
    })

    // ── COGNITO USER POOL ──────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'VexaUserPool', {
      userPoolName: 'vexa-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const userPoolClient = new cognito.UserPoolClient(this, 'VexaUserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          'http://localhost:3000/auth/callback',
          'https://app.sovexa.ai/auth/callback',
        ],
      },
    })

    // ── RDS POSTGRESQL ─────────────────────────────────────────────────────────
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc,
      description: 'Vexa RDS Security Group',
    })

    const database = new rds.DatabaseInstance(this, 'VexaDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_4,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      databaseName: 'vexa',
      credentials: rds.Credentials.fromGeneratedSecret('vexa_admin'),
      backupRetention: cdk.Duration.days(7),
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // ── S3 BUCKET (outputs + video assets) ────────────────────────────────────
    const outputsBucket = new s3.Bucket(this, 'VexaOutputsBucket', {
      bucketName: 'vexa-outputs',
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'delete-old-videos',
          expiration: cdk.Duration.days(90),
          prefix: 'videos/temp/',
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // ── LAMBDA EXECUTION ROLE ─────────────────────────────────────────────────
    const lambdaRole = new iam.Role(this, 'VexaLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    })

    // Bedrock permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock-agent-runtime:Retrieve',
      ],
      resources: ['*'],
    }))

    // S3 permissions
    outputsBucket.grantReadWrite(lambdaRole)

    // ── API LAMBDA ────────────────────────────────────────────────────────────
    const apiLambda = new lambda.Function(this, 'VexaApiLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../apps/api/dist'),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        NODE_ENV: 'production',
        AWS_BEDROCK_REGION: this.region,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        S3_BUCKET: outputsBucket.bucketName,
        // DATABASE_URL injected from Secrets Manager at deploy time
      },
    })

    // ── API GATEWAY ───────────────────────────────────────────────────────────
    const api = new apigateway.RestApi(this, 'VexaApi', {
      restApiName: 'Vexa API',
      description: 'Vexa content company OS API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    const lambdaIntegration = new apigateway.LambdaIntegration(apiLambda)
    api.root.addProxy({ defaultIntegration: lambdaIntegration })

    // ── OUTPUTS ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId })
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url })
    new cdk.CfnOutput(this, 'DatabaseEndpoint', { value: database.instanceEndpoint.hostname })
    new cdk.CfnOutput(this, 'OutputsBucket', { value: outputsBucket.bucketName })
  }
}
